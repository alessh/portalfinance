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
import { redactPluggyPayload } from '@/lib/pluggyRedaction';
import { hashPluggyItemId } from '@/lib/crypto';

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
  // Replace body.itemId with body.itemIdHash hex BEFORE the INSERT (and reuse the
  // hash buffer for the inline audit lookup below). UNIQUE(source, event_id)
  // ensures replays are no-ops; RETURNING id distinguishes new vs duplicate.
  const item_id_hash_buf =
    typeof body.itemId === 'string' && body.itemId.length > 0
      ? hashPluggyItemId(body.itemId)
      : undefined;
  const item_id_hash_hex = item_id_hash_buf?.toString('hex');
  const redacted = redactPluggyPayload(body);

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

      // D-13 + D-30: emit item_reauth_succeeded audit inline on item/login_succeeded.
      // The audit MUST be timestamped at webhook receipt (not at worker dequeue),
      // so we record it here before returning 200.
      // PII guard (P13): only the HMAC of the Pluggy itemId is stored in metadata —
      // NEVER the plaintext itemId. We reuse item_id_hash_buf computed above.
      if (body.event === 'item/login_succeeded' && item_id_hash_buf) {
        try {
          const { recordAudit } = await import('@/lib/auditLog');
          const { pluggy_items } = await import('@/db/schema');
          const { eq } = await import('drizzle-orm');
          const item = await db.query.pluggy_items.findFirst({
            where: eq(pluggy_items.pluggy_item_id_hash, item_id_hash_buf),
            columns: { id: true, user_id: true },
          });
          if (item) {
            await recordAudit({
              user_id: item.user_id,
              action: 'item_reauth_succeeded',
              // Only the HMAC hash is stored — plaintext itemId NEVER in metadata (P13, P4)
              metadata: { item_id_hashed: item_id_hash_buf.toString('hex') },
            });
          }
        } catch (audit_err) {
          // Audit failure must NOT block the 200 response — log and continue.
          // pg-boss has already received the PLUGGY_SYNC enqueue above.
          logger.warn(
            { event: 'pluggy_reauth_audit_failed', error: String(audit_err) },
            'failed to write item_reauth_succeeded audit — non-fatal',
          );
        }
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
