/**
 * SES bounce / complaint pg-boss worker.
 *
 * Plan 01-04 — D-15, T-WH-REPLAY mitigation.
 *
 * Reads webhook_events rows created by the SES bounce webhook handler,
 * parses the SNS envelope to extract bounced/complained email addresses,
 * and writes (or updates) ses_suppressions rows.
 *
 * Idempotency (T-WH-REPLAY):
 *   - The webhook handler already deduplicates at the webhook_events level.
 *   - ses_suppressions uses onConflictDoUpdate to array_append notification_ids
 *     on repeat events for the same email — safe to replay.
 *   - processed_at is set after the worker runs to prevent double-processing.
 */
import type { Job } from 'pg-boss';
import { db } from '@/db';
import { webhook_events, ses_suppressions } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

interface Payload {
  webhook_event_id: string;
}

interface SesBounceNotification {
  notificationType: 'Bounce' | 'Complaint';
  mail: { messageId: string };
  bounce?: {
    bouncedRecipients: Array<{ emailAddress: string }>;
    bounceType?: string;
  };
  complaint?: {
    complainedRecipients: Array<{ emailAddress: string }>;
  };
}

export async function sesBounceWorker(jobs: Job<Payload>[]): Promise<void> {
  for (const job of jobs) {
    const [ev] = await db
      .select()
      .from(webhook_events)
      .where(eq(webhook_events.id, job.data.webhook_event_id));

    if (!ev) {
      logger.warn(
        { event: 'ses_bounce_worker_not_found', webhook_event_id: job.data.webhook_event_id },
        'webhook_events row not found — skipping',
      );
      continue;
    }

    if (ev.processed_at) {
      // Already processed (double-delivery guard).
      logger.info(
        { event: 'ses_bounce_worker_duplicate', id: ev.id },
        'webhook_event already processed — skipping',
      );
      continue;
    }

    // The SNS envelope has a `Message` field that is JSON-encoded.
    const envelope = ev.payload as Record<string, unknown>;
    let notif: SesBounceNotification;
    try {
      notif = JSON.parse((envelope.Message as string) ?? '{}') as SesBounceNotification;
    } catch {
      logger.error(
        { event: 'ses_bounce_worker_malformed', id: ev.id },
        'Failed to parse SES notification JSON',
      );
      continue;
    }

    const reason: string =
      notif.notificationType === 'Complaint' ? 'COMPLAINT' : 'BOUNCE';

    const recipients: string[] =
      notif.bounce?.bouncedRecipients?.map((r) => r.emailAddress) ??
      notif.complaint?.complainedRecipients?.map((r) => r.emailAddress) ??
      [];

    for (const email of recipients) {
      const email_lower = email.toLowerCase();
      await db
        .insert(ses_suppressions)
        .values({
          email_lower,
          reason,
          notification_ids: [envelope.MessageId as string],
        })
        .onConflictDoUpdate({
          target: ses_suppressions.email_lower,
          set: {
            // Append the new notification ID to the existing array (idempotent for replays).
            notification_ids: sql`array_append(${ses_suppressions.notification_ids}, ${String(envelope.MessageId)})`,
          },
        });

      logger.info(
        { event: 'ses_suppression_written', email_lower, reason, webhook_event_id: ev.id },
        'SES suppression row written',
      );
    }

    // Mark the event as processed.
    await db
      .update(webhook_events)
      .set({ processed_at: new Date() })
      .where(eq(webhook_events.id, ev.id));
  }
}
