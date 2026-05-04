/**
 * itemReauthSucceededAuditWorker — Plan 02-12, Concern #3 closure.
 *
 * Moves the inline audit write that previously lived in
 * `src/app/api/webhooks/pluggy/route.ts` (lines 168-195 of the pre-02-12 file)
 * into an async worker. The webhook receiver now only verifies signature +
 * INSERTs webhook_events + ENQUEUEs jobs — meeting the <200ms latency budget
 * under load and matching the receiver-only-auth-and-insert pattern in
 * `02-CONTEXT.md` Specifics § Webhook receiver structure.
 *
 * Idempotency: pg-boss may retry on transient failures. We key idempotency on
 * the webhook_event_id (the primary key of the webhook_events row, which
 * uniquely identifies one Pluggy delivery). Before inserting an audit_log row
 * we check whether one already exists for that webhook_event_id via a JSONB
 * containment query on metadata.
 *
 * PII contract (P4 / P13): the worker payload carries `item_id_hash_hex`
 * (lower-hex of the receiver's HMAC over PLUGGY_ITEM_ID_HASH_PEPPER), never
 * plaintext. The hash is also what lands in `audit_log.metadata.item_id_hashed`,
 * matching the auditor-visible content of the pre-02-12 implementation.
 */

import type { Job } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { audit_log, pluggy_items } from '@/db/schema';
import { recordAudit } from '@/lib/auditLog';
import { logger } from '@/lib/logger';

interface Payload {
  item_id_hash_hex: string;
  webhook_event_id: string;
}

export async function itemReauthSucceededAuditWorker(
  jobs: Job<Payload>[],
): Promise<void> {
  for (const job of jobs) {
    try {
      const { item_id_hash_hex, webhook_event_id } = job.data;
      if (!item_id_hash_hex || !webhook_event_id) {
        logger.warn(
          {
            event: 'reauth_audit_skipped',
            reason: 'missing_payload',
            job_id: job.id,
          },
          'reauth audit job skipped — incomplete payload',
        );
        return;
      }

      // Idempotency check — has an audit row for this webhook delivery
      // already been written? Use a JSONB containment query on metadata
      // (`metadata @> {"webhook_event_id": $1}`) to find prior writes,
      // backed by an additional text-match on `metadata->>'webhook_event_id'`
      // for engines that index text extraction better than @>. If a row
      // already exists, skip; pg-boss may have retried.
      const existing = await db
        .select({ id: audit_log.id })
        .from(audit_log)
        .where(
          sql`${audit_log.action} = 'item_reauth_succeeded'
              AND (
                ${audit_log.metadata} @> ${JSON.stringify({ webhook_event_id })}::jsonb
                OR ${audit_log.metadata}->>'webhook_event_id' = ${webhook_event_id}
              )`,
        )
        .limit(1);

      if (existing.length > 0) {
        logger.info(
          { event: 'reauth_audit_idempotent_skip', webhook_event_id },
          'audit row already exists for this webhook delivery — skipping',
        );
        return;
      }

      // Resolve pluggy_items row via the hash (decode hex → bytea).
      const hashBuf = Buffer.from(item_id_hash_hex, 'hex');
      const item = await db.query.pluggy_items.findFirst({
        where: eq(pluggy_items.pluggy_item_id_hash, hashBuf),
        columns: { id: true, user_id: true },
      });

      if (!item) {
        // Permanent failure — DO NOT throw; that would trigger pg-boss retries
        // pointlessly. The hash uniquely identifies a missing row, not a
        // transient state.
        logger.warn(
          {
            event: 'reauth_audit_skipped',
            reason: 'item_not_found',
            webhook_event_id,
          },
          'pluggy_items row not found for hash — audit skipped',
        );
        return;
      }

      await recordAudit({
        user_id: item.user_id,
        action: 'item_reauth_succeeded',
        actor_type: 'SYSTEM',
        metadata: {
          item_id_hashed: item_id_hash_hex,
          webhook_event_id,
        },
      });

      logger.info(
        { event: 'reauth_audit_written', webhook_event_id },
        'item_reauth_succeeded audit row written',
      );
    } catch (err) {
      logger.error(
        {
          event: 'worker_job_failed',
          job_id: job.id,
          worker: 'itemReauthSucceededAudit',
          error: String(err),
        },
        'reauth audit worker failed — pg-boss will retry',
      );
      throw err;
    }
  }
}
