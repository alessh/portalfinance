/**
 * Re-auth Notifier Worker — Plan 02-05 (D-34, D-35, CONN-03).
 *
 * Sends a "reconnect your bank" email when a Pluggy item enters
 * LOGIN_ERROR or WAITING_USER_INPUT state and the 24h debounce has expired.
 *
 * Flow:
 *   1. Resolve internal `pluggy_items` row (by UUID or HMAC hash lookup).
 *   2. D-34: skip if `last_reauth_email_at < now() - 24h` (debounce guard).
 *   3. Fetch user email from `users` table.
 *   4. Build `reconnect_url = NEXTAUTH_URL + /connect?reconnect={item.id}` (D-35).
 *      NEVER includes the raw Pluggy item ID (P4).
 *   5. Send email via mailer with HTML + plaintext alternate (D-35).
 *   6. Update `pluggy_items.last_reauth_email_at = now()`.
 *   7. Emit `item_reauth_started` audit row (D-13).
 *
 * Debounce (D-34): prevents email storms from repeated Pluggy webhook retries.
 * The 24h window means at most 1 re-auth email per item per day.
 *
 * PII contract (P4 / D-35):
 *   - `reconnect_url` uses internal UUID only — not raw Pluggy item ID.
 *   - Log lines emit only hashed item/user IDs (P13 / Pattern S7).
 *   - Webhook-driven jobs carry item_id_hash_hex (lower-hex of the receiver's
 *     HMAC over PLUGGY_ITEM_ID_HASH_PEPPER) — never plaintext (Concern #1).
 */
import type { Job } from 'pg-boss';
import { eq } from 'drizzle-orm';
import * as React from 'react';
import { db } from '@/db';
import { pluggy_items, users } from '@/db/schema';
import { sendEmail } from '@/lib/mailer';
import { logger } from '@/lib/logger';
import { hashUserIdForSentry as hashId } from '@/lib/sentry';
import { env } from '@/lib/env';
import { ReAuthRequired, renderReAuthRequiredText } from '@/emails/ReAuthRequired';
import { recordAudit } from '@/lib/auditLog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 24-hour debounce window in milliseconds (D-34). */
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Payload type (mirrors webhook receiver dispatch shape from plan 02-04)
// ---------------------------------------------------------------------------

interface Payload {
  webhook_event_id?: string;
  item_id_hash_hex?: string; // lower-hex of hashPluggyItemId(plaintext) — set by webhook receiver (Concern #1)
  item_id?: string;          // internal pluggy_items UUID (direct path)
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export async function reAuthNotifierWorker(jobs: Job<Payload>[]): Promise<void> {
  for (const job of jobs) {
    try {
      // -----------------------------------------------------------------------
      // 1. Resolve internal pluggy_items row
      //    - Direct path: job.data.item_id is the internal UUID.
      //    - Webhook path: job.data.item_id_hash_hex is the receiver-computed
      //      HMAC hex; decode and look up by pluggy_item_id_hash (Concern #1).
      // -----------------------------------------------------------------------
      let item: typeof pluggy_items.$inferSelect | undefined;

      if (job.data.item_id) {
        item = await db.query.pluggy_items.findFirst({
          where: eq(pluggy_items.id, job.data.item_id),
        });
      } else if (job.data.item_id_hash_hex) {
        // Concern #1: pg-boss row carries the HMAC hex, never the plaintext
        // pluggy_item_id. OQ#6 RESOLVED: receiver used HMAC-SHA256 with
        // PLUGGY_ITEM_ID_HASH_PEPPER (NOT bare SHA-256).
        const hash_buf = Buffer.from(job.data.item_id_hash_hex, 'hex');
        item = await db.query.pluggy_items.findFirst({
          where: eq(pluggy_items.pluggy_item_id_hash, hash_buf),
        });
      }

      if (!item) {
        logger.warn(
          { event: 'reauth_notifier_item_not_found', job_id: job.id },
          'pluggy item not found — skipping re-auth notification',
        );
        return;
      }

      // -----------------------------------------------------------------------
      // 2. D-34: debounce guard — skip if last email sent within 24h
      // -----------------------------------------------------------------------
      if (
        item.last_reauth_email_at &&
        item.last_reauth_email_at.getTime() > Date.now() - TWENTY_FOUR_HOURS_MS
      ) {
        const elapsed_seconds = Math.floor(
          (Date.now() - item.last_reauth_email_at.getTime()) / 1000,
        );
        logger.info(
          {
            event: 'reconnect_email_debounced',
            item_id_hashed: hashId(item.id),
            debounce_seconds: elapsed_seconds,
          },
          'reconnect email debounced — within 24h window',
        );
        return;
      }

      // -----------------------------------------------------------------------
      // 3. Fetch user email
      // -----------------------------------------------------------------------
      const user = await db.query.users.findFirst({
        where: eq(users.id, item.user_id),
        columns: { email: true },
      });

      if (!user) {
        logger.warn(
          { event: 'reauth_notifier_user_not_found', item_id_hashed: hashId(item.id) },
          'user not found for re-auth notification — skipping',
        );
        return;
      }

      // -----------------------------------------------------------------------
      // 4. Build reconnect URL (D-35 — internal UUID only, NOT Pluggy item ID)
      // -----------------------------------------------------------------------
      const reconnect_url = `${env.NEXTAUTH_URL}/connect?reconnect=${item.id}`;

      const email_props = {
        institution_name: item.institution_name,
        last_synced_at: item.last_synced_at ?? item.created_at,
        reconnect_url,
      };

      // -----------------------------------------------------------------------
      // 5. Send email with HTML + plaintext alternate (D-35)
      // -----------------------------------------------------------------------
      await sendEmail({
        to: user.email,
        subject: `Reconecte seu ${item.institution_name}`,
        template: React.createElement(ReAuthRequired, email_props),
        plaintext: renderReAuthRequiredText(email_props),
      });

      // -----------------------------------------------------------------------
      // 6. Update debounce timestamp
      // -----------------------------------------------------------------------
      await db
        .update(pluggy_items)
        .set({ last_reauth_email_at: new Date(), updated_at: new Date() })
        .where(eq(pluggy_items.id, item.id));

      logger.info(
        {
          event: 'reconnect_email_sent',
          item_id_hashed: hashId(item.id),
          debounce_seconds: 0,
        },
        'reconnect email sent',
      );

      // -----------------------------------------------------------------------
      // 7. Audit row (D-13)
      // -----------------------------------------------------------------------
      await recordAudit({
        user_id: item.user_id,
        actor_type: 'SYSTEM',
        action: 'item_reauth_started',
        metadata: {
          connector_id: item.connector_id,
          institution_name: item.institution_name,
          cooldown_bypassed: false,
        },
      });
    } catch (err) {
      logger.error(
        {
          event: 'worker_job_failed',
          job_id: job.id,
          worker: 'reAuthNotifier',
          error: String(err),
        },
        'Job processing failed — pg-boss will retry',
      );
      throw err;
    }
  }
}
