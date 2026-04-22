/**
 * SES bounce / complaint SNS webhook receiver.
 *
 * Plan 01-04 — T-WH-REPLAY + T-WH-FORGE mitigations (D-15).
 *
 * Architecture (CONTEXT.md):
 *   SNS topic → HTTPS POST to this route → idempotent webhook_events INSERT
 *   → enqueue ses.bounce pg-boss job → return 200 in < 200 ms
 *
 * The sesBounceWorker runs asynchronously and writes ses_suppressions rows.
 * The mailer suppression guard blocks future sends to affected addresses.
 *
 * CRITICAL invariants:
 *   1. verifySnsMessage MUST precede any DB insert (T-WH-FORGE).
 *   2. webhook_events uses UNIQUE(source, event_id) + onConflictDoNothing —
 *      idempotent; replaying the same MessageId is a no-op (T-WH-REPLAY).
 *   3. Return 200 < 200 ms after insert + enqueue (SNS retries on non-2xx).
 *      No heavy work happens here — only the idempotent insert + enqueue.
 */
export const runtime = 'nodejs';

import { db } from '@/db';
import { webhook_events } from '@/db/schema';
import { enqueue, QUEUES } from '@/jobs/boss';
import { verifySnsMessage, type SnsMessage } from '@/lib/snsVerifier';
import { logger } from '@/lib/logger';

export async function POST(req: Request): Promise<Response> {
  const start = Date.now();

  // --- Parse body ---
  let body: SnsMessage;
  try {
    body = (await req.json()) as SnsMessage;
  } catch {
    return new Response('bad json', { status: 400 });
  }

  // --- 1. Verify SNS signature (MUST be first — T-WH-FORGE) ---
  const sig_ok = await verifySnsMessage(body);
  if (!sig_ok) {
    logger.warn(
      { event: 'ses_bounce_signature_failed', messageId: body.MessageId },
      'SNS signature rejected',
    );
    return new Response('bad signature', { status: 401 });
  }

  // --- 2. SubscriptionConfirmation handshake (one-time per SNS subscription) ---
  if (body.Type === 'SubscriptionConfirmation' && body.SubscribeURL) {
    await fetch(body.SubscribeURL).catch((err) =>
      logger.error({ err: String(err) }, 'SNS subscribe confirm fetch failed'),
    );
    logger.info({ event: 'ses_bounce_subscribed', topicArn: body.TopicArn }, 'SNS subscription confirmed');
    return new Response('subscribed', { status: 200 });
  }

  // --- 3. Notification — idempotent insert + enqueue ---
  if (body.Type === 'Notification') {
    const inserted = await db
      .insert(webhook_events)
      .values({
        source: 'SES',
        event_type: 'bounce',
        event_id: body.MessageId,
        payload: body as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: webhook_events.id });

    const was_duplicate = inserted.length === 0;

    if (!was_duplicate) {
      // Only enqueue when the event is new (not a duplicate replay).
      await enqueue(QUEUES.SES_BOUNCE, { webhook_event_id: inserted[0].id });
    }

    logger.info({
      event: 'ses_bounce_received',
      messageId: body.MessageId,
      latency_ms: Date.now() - start,
      was_duplicate,
    }, 'SES bounce webhook processed');
  }

  // Return 200 for all valid notification types (SNS retries on non-2xx).
  return new Response('ok', { status: 200 });
}
