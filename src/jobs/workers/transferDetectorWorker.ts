/**
 * Transfer Detector Worker — Plan 02-05 (TX-04, D-33).
 *
 * Identifies same-user cross-account transfers by applying the D-33
 * 4-invariant deterministic heuristic:
 *   1. Same |amount| (numeric equality — no fuzzy matching, no confidence score)
 *   2. Opposite transaction type (one DEBIT, one CREDIT)
 *   3. Different account_id (cross-account only — internal bookkeeping excluded)
 *   4. posted_at within ≤3 days of each other
 *
 * Both legs of a matching pair are flagged `is_transfer=true` in a single
 * atomic SQL statement. `transfer_pair_id` is set on each row pointing to
 * the other row's id. Already-flagged rows are excluded by the WHERE clause
 * to ensure idempotency (T-02-F / transfer-6).
 *
 * Audit: `transfer_detected` is emitted only when count > 0 (D-13).
 * PII contract: only hashed user_id appears in logs (P13 / Pattern S7).
 */
import type { Job } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { transactions } from '@/db/schema';
import { logger } from '@/lib/logger';
import { hashUserIdForSentry as hashId } from '@/lib/sentry';
import { recordAudit } from '@/lib/auditLog';

interface Payload {
  user_id: string;
}

export async function transferDetectorWorker(jobs: Job<Payload>[]): Promise<void> {
  for (const job of jobs) {
    const user_id = job.data.user_id;
    try {
      // D-33: same |amount|, opposite type, same user, two different account_id, ≤3 days posted_at delta.
      // Run as a single SQL statement that pairs candidates and updates both legs atomically.
      // Both t1 and t2 must have is_transfer=false to exclude already-flagged pairs (idempotency).
      // t1.id < t2.id prevents double-pairing (each pair found exactly once).
      const result = await db.execute<{ flagged: number }>(sql`
        WITH candidates AS (
          SELECT t1.id AS id_a, t2.id AS id_b
          FROM ${transactions} t1
          INNER JOIN ${transactions} t2
            ON t1.user_id = t2.user_id
            AND t2.user_id = ${user_id}
            AND t1.id < t2.id
            AND t1.is_transfer = false
            AND t2.is_transfer = false
            AND t1.account_id <> t2.account_id
            AND t1.amount = t2.amount
            AND t1.type <> t2.type
            AND ABS(EXTRACT(EPOCH FROM (t1.posted_at - t2.posted_at))) <= 3 * 24 * 60 * 60
        ),
        updated AS (
          UPDATE ${transactions} t
          SET is_transfer = true,
              transfer_pair_id = CASE
                WHEN t.id = c.id_a THEN c.id_b
                WHEN t.id = c.id_b THEN c.id_a
              END,
              updated_at = now()
          FROM candidates c
          WHERE t.id IN (c.id_a, c.id_b)
          RETURNING t.id
        )
        SELECT count(*)::int AS flagged FROM updated
      `);

      // Drizzle execute() return shape differs by driver:
      //   - postgres-js: result is the rows array directly (result[0].flagged)
      //   - node-postgres: result is { rows: [...] } (result.rows[0].flagged)
      // The coalesce below tolerates both shapes.
      const rows_arr = (result as unknown as Array<{ flagged: number }>);
      const rows_obj = (result as unknown as { rows: Array<{ flagged: number }> });
      const flagged = rows_arr[0]?.flagged ?? rows_obj.rows?.[0]?.flagged ?? 0;

      logger.info(
        {
          event: 'transfer_detected',
          user_id_hashed: hashId(user_id),
          count: flagged,
        },
        'transfer detector run',
      );

      if (flagged > 0) {
        await recordAudit({
          user_id,
          actor_type: 'SYSTEM',
          action: 'transfer_detected',
          metadata: { count: flagged },
        });
      }
    } catch (err) {
      logger.error(
        {
          event: 'worker_job_failed',
          job_id: job.id,
          worker: 'transferDetector',
          error: String(err),
        },
        'Job processing failed — pg-boss will retry',
      );
      throw err;
    }
  }
}
