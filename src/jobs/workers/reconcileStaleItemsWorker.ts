/**
 * Reconcile Stale Items Worker — Plan 02-05 (TX-06, D-38).
 *
 * Hourly cron worker that identifies Pluggy items which have not been synced
 * in the last 12 hours and enqueues a PLUGGY_SYNC job for each.
 *
 * Selection criteria (D-38):
 *   - `last_synced_at IS NULL OR last_synced_at < now() - interval '12 hours'`
 *   - `status NOT IN ('LOGIN_ERROR', 'WAITING_USER_INPUT')` — broken items are
 *     excluded because syncing them would not succeed and would waste API quota.
 *
 * Cron schedule: `0 * * * *` with `tz: 'America/Sao_Paulo'` (hourly at :00 BRT, D-38).
 * Registered in worker.ts via `boss.schedule(...)`.
 *
 * Safety:
 *   - Per-user `singletonKey` at enqueue prevents double-queuing the same user
 *     when multiple stale items exist (D-41 / Pattern S5).
 *   - High-stale-count alarm: logs warn when >5 items are stale in one tick
 *     (likely indicates a systematic sync failure worth investigating).
 *
 * PII contract (P13 / Pattern S7):
 *   - Log lines include only stale item count — no user_id, no item_id.
 */
import type { Job } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { pluggy_items } from '@/db/schema';
import { enqueue, QUEUES } from '@/jobs/boss';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export async function reconcileStaleItemsWorker(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    try {
      // D-38: fetch items stale for >12h, excluding non-syncable statuses.
      // Concerns #6 + #7 (plan 02-15) — DISCONNECTED is terminal user
      // revocation, must never be resurrected by the cron. UPDATING is
      // already in-flight; pg-boss singletonKey would dedup the enqueue
      // anyway but the SQL filter avoids the wasted INSERT.
      const stale = await db.execute<{ id: string; user_id: string }>(sql`
        SELECT id, user_id
        FROM ${pluggy_items}
        WHERE (last_synced_at IS NULL OR last_synced_at < now() - interval '12 hours')
          AND status NOT IN ('LOGIN_ERROR', 'WAITING_USER_INPUT', 'DISCONNECTED', 'UPDATING')
      `);

      // Drizzle execute() return shape differs by driver (see transferDetectorWorker.ts note).
      const rows =
        (stale as unknown as { rows?: Array<{ id: string; user_id: string }> }).rows ??
        (stale as unknown as Array<{ id: string; user_id: string }>);

      for (const row of rows) {
        // D-41 singletonKey: per-user dedup prevents the same user from having
        // more than 1 PLUGGY_SYNC job in-flight at a time (Pattern S5).
        // D-41: singletonKey prevents the same user from having >1 PLUGGY_SYNC job
        // in-flight at a time (Pattern S5). singletonSeconds: 0 means in-flight dedup
        // only (no time-window dedup — matches the pluggySyncWorker registration comment).
        await enqueue(
          QUEUES.PLUGGY_SYNC,
          { user_id: row.user_id, item_id: row.id, trigger: 'reconcile' },
          { singletonKey: row.user_id, singletonSeconds: 0 },
        );
      }

      if (rows.length > 5) {
        // High stale count likely indicates a systematic sync failure.
        logger.warn(
          { event: 'pluggy_reconcile_high_stale_count', count: rows.length },
          'reconciliation queued >5 stale items — investigate sync health',
        );
      } else {
        logger.info(
          { event: 'pluggy_reconcile_run', count: rows.length },
          'reconciliation cron tick',
        );
      }
    } catch (err) {
      logger.error(
        {
          event: 'worker_job_failed',
          job_id: job.id,
          worker: 'reconcileStaleItems',
          error: String(err),
        },
        'Job processing failed — pg-boss will retry',
      );
      throw err;
    }
  }
}
