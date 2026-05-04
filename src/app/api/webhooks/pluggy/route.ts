/**
 * Pluggy webhook receiver.
 *
 * Plan 02-04 — T-02-A (webhook forgery), T-02-B (replay attack) mitigations.
 * Requirements: CONN-02, CONN-07, Pitfalls P3, P5, P10.
 *
 * Architecture:
 *   Pluggy → POST /api/webhooks/pluggy
 *     → constant-time compare X-Pluggy-Signature vs PLUGGY_WEBHOOK_SECRET (D-42)
 *     → idempotent webhook_events INSERT ON CONFLICT DO NOTHING
 *     → event→queue mapping (mapEventToQueue)
 *     → optional audit log for item/login_succeeded (D-30, D-13)
 *     → return 200 in <200ms (Pluggy retries on non-2xx, up to 9 attempts)
 *
 * CRITICAL invariants:
 *   1. timingSafeEqual MUST precede any DB insert (T-02-A).
 *   2. webhook_events uses UNIQUE(source, event_id) + onConflictDoNothing (T-02-B).
 *   3. Unknown event types → row inserted, NO enqueue, log pluggy_webhook_unmapped_event (P10).
 *   4. Response budget: <200ms. pg-boss send() is a fast DB INSERT; enqueue BEFORE returning.
 *   5. PII guard (P13): NEVER log raw itemId, eventId, or connectorId — audit path only.
 */
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { db } from '@/db';
import { webhook_events } from '@/db/schema';
import { enqueue, QUEUES } from '@/jobs/boss';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { redactPluggyPayload, REDACTED_ITEM_ID_KEY } from '@/lib/pluggyRedaction';

// ---------------------------------------------------------------------------
// Pluggy webhook payload shape (Pluggy docs § Webhooks)
// ---------------------------------------------------------------------------

interface PluggyEvent {
  event: string;
  eventId: string;
  itemId?: string;
  clientId?: string;
  error?: { code?: string; message?: string };
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Event → queue mapping (D-42, CONTEXT.md § Webhook event → worker mapping)
// ---------------------------------------------------------------------------

/**
 * Maps Pluggy event type to the pg-boss queue name to enqueue.
 *
 * Returns null for explicit no-ops (item/deleted, connector/status_updated)
 * AND for unknown event types (Pitfall P10 — still insert row, just no enqueue).
 */
function mapEventToQueue(event_type: string): string | null {
  switch (event_type) {
    // Sync triggers — item lifecycle events that require a fresh transaction fetch
    case 'item/created':
    case 'item/updated':
    case 'item/login_succeeded':
    case 'transactions/created':
    case 'transactions/updated':
    case 'transactions/deleted':
      return QUEUES.PLUGGY_SYNC;

    // Re-auth triggers — item entered a broken state requiring user action
    case 'item/error':
    case 'item/waiting_user_input':
      return QUEUES.PLUGGY_REAUTH_NOTIFIER;

    // Explicit no-ops — events we acknowledge but do not act on in Phase 2
    case 'item/deleted':          // we initiate deletes; webhook is confirmation only
    case 'connector/status_updated': // connector health; no Phase 2 action
      return null;

    // Unknown / future Pluggy event types (P10):
    // Store the row for auditability, emit pluggy_webhook_unmapped_event log,
    // do NOT enqueue any job. This prevents future Pluggy events (e.g., payment_intent/*)
    // from silently being lost AND prevents them from triggering unexpected sync jobs.
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  const start = Date.now();

  // --- 1. Verify custom signature header (D-42, T-02-A) ---
  // Constant-time compare prevents timing-side-channel attacks that would
  // allow an attacker to guess the secret byte-by-byte.
  //
  // CR-01 (review fix): if PLUGGY_WEBHOOK_SECRET is not configured we MUST
  // reject the request outright. Comparing two empty buffers via
  // timingSafeEqual would otherwise pass for any request that omits the
  // signature header, opening the webhook to forgery in any environment
  // where the secret was not set (staging, misconfigured prod, dev-as-prod).
  const expected = env.PLUGGY_WEBHOOK_SECRET;
  if (!expected) {
    logger.error(
      { event: 'pluggy_webhook_no_secret' },
      'PLUGGY_WEBHOOK_SECRET not configured — rejecting all webhook requests',
    );
    return new Response('service unavailable', { status: 503 });
  }
  const sig_header = req.headers.get('x-pluggy-signature') ?? '';
  const sig_buf = Buffer.from(sig_header);
  const exp_buf = Buffer.from(expected);
  if (
    sig_buf.length === 0 ||
    sig_buf.length !== exp_buf.length ||
    !timingSafeEqual(sig_buf, exp_buf)
  ) {
    logger.warn({ event: 'pluggy_webhook_signature_failed' }, 'invalid signature');
    return new Response('unauthorized', { status: 401 });
  }

  // --- 2. Parse JSON body ---
  let body: PluggyEvent;
  try {
    body = (await req.json()) as PluggyEvent;
  } catch {
    return new Response('bad json', { status: 400 });
  }
  if (!body.event || !body.eventId) {
    return new Response('bad payload', { status: 400 });
  }

  // --- 3. Redact + idempotent INSERT into webhook_events (T-02-B + Concern #1) ---
  // Concern #1: webhook_events.payload MUST NOT contain plaintext pluggy_item_id.
  // redactPluggyPayload removes body.itemId AND adds itemIdHash hex BEFORE the
  // INSERT. We pull item_id_hash_hex back out of the redacted payload to use as
  // the worker enqueue key — this keeps the hashing concern in one place
  // (`@/lib/pluggyRedaction`) and removes hashing logic from the receiver.
  // UNIQUE(source, event_id) ensures replays are no-ops; RETURNING id
  // distinguishes new vs duplicate.
  const redacted = redactPluggyPayload(body);
  const item_id_hash_hex =
    typeof redacted[REDACTED_ITEM_ID_KEY] === 'string'
      ? (redacted[REDACTED_ITEM_ID_KEY] as string)
      : undefined;

  const inserted = await db
    .insert(webhook_events)
    .values({
      source: 'PLUGGY',
      event_type: body.event,
      event_id: body.eventId,
      payload: redacted as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: webhook_events.id });

  const was_duplicate = inserted.length === 0;

  // --- 4. Enqueue if mapped + new ---
  if (!was_duplicate) {
    const queue = mapEventToQueue(body.event);
    if (queue) {
      // D-30: reconnect path — when Pluggy fires item/login_succeeded, the user
      // has just completed the update-mode (re-auth) flow inside the widget.
      // Force trigger='reconnect' so the worker bypasses cooldown AND uses a
      // 12-month sync window (full re-fetch, not 7-day incremental).
      // Other events use the default trigger='webhook'.
      const trigger = body.event === 'item/login_succeeded' ? 'reconnect' : 'webhook';
      // Concern #1: pg-boss row MUST NOT carry plaintext pluggy_item_id. Pass the
      // hash hex; workers decode and look up via pluggy_item_id_hash bytea.
      await enqueue(queue, {
        webhook_event_id: inserted[0].id,
        item_id_hash_hex,
        trigger,
      });

      // Concern #3 (02-REVIEWS.md / plan 02-12): the inline audit lookup +
      // insert was moved out of the receiver hot path into the
      // PLUGGY_REAUTH_AUDIT queue. The receiver now only enqueues the audit
      // job — the worker performs the lookup + insert idempotently keyed on
      // webhook_event_id. The 200 response no longer waits on a DB SELECT +
      // INSERT for item/login_succeeded events.
      if (body.event === 'item/login_succeeded' && item_id_hash_hex) {
        await enqueue(QUEUES.PLUGGY_REAUTH_AUDIT, {
          webhook_event_id: inserted[0].id,
          item_id_hash_hex,
        });
      }
    } else {
      // Unknown or explicit no-op event type (P10) — row already inserted above.
      // Log with the event_type so ops can see unmapped events in production.
      // Do NOT log body.itemId or body.eventId in structured fields (P13).
      logger.info(
        { event: 'pluggy_webhook_unmapped_event', event_type: body.event },
        'unmapped pluggy event stored only — no job enqueued',
      );
    }
  }

  // --- 5. Tail log + 200 response ---
  // latency_ms must be <200ms for Pluggy's 5s response budget.
  // We log event_type but NOT itemId or eventId (P13 PII guard).
  logger.info(
    {
      event: 'pluggy_webhook_received',
      event_type: body.event,
      latency_ms: Date.now() - start,
      was_duplicate,
    },
    'pluggy webhook processed',
  );

  return new Response('ok', { status: 200 });
}
