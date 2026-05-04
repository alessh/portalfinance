/**
 * Transfer Detector Worker — Plan 02-05 (TX-04, D-33), revised by plan 02-13.
 *
 * Identifies same-user cross-account transfers by applying the D-33
 * 4-invariant deterministic heuristic:
 *   1. Same |amount| (numeric equality — no fuzzy matching, no confidence score)
 *   2. Opposite transaction type (one DEBIT, one CREDIT)
 *   3. Different account_id (cross-account only — internal bookkeeping excluded)
 *   4. posted_at within ≤3 days of each other
 *
 * Plan 02-13 — Concern #4 closure: the original broad self-join produced
 * multi-pair candidates when one debit matched multiple credits of the same
 * amount within the 3-day window, leaving the planner to choose which pair
 * "won" the UPDATE. The replacement pipeline computes a deterministic
 * mutual-best-match: for every debit pick the closest credit by |posted_at|
 * delta (ties broken by smallest credit.id::text), then symmetrically for
 * every credit pick the closest debit. Pairs that appear in BOTH sides win.
 * This guarantees each transaction appears in AT MOST ONE pair (1-to-1
 * invariant) AND that re-runs on the same data produce byte-identical
 * `transfer_pair_id` assignments.
 *
 * Both legs of a matching pair are flagged `is_transfer=true` in a single
 * atomic SQL statement. `transfer_pair_id` is set on each row pointing to
 * the other row's id. Already-flagged rows are excluded by the candidate
 * filter to ensure idempotency (T-02-F / transfer-6).
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
      // Plan 02-13 — Concern #4 closure: deterministic mutual best match
      // (ROW_NUMBER tie-break) replaces the original broad self-join.
      //
      // Pipeline:
      //   same_user_pairs : every (debit, credit) candidate satisfying D-33's
      //                     4 invariants (same user, opposite type, different
      //                     accounts, equal amount, ≤3 days apart). Already-
      //                     flagged transactions are excluded for idempotency.
      //   debit_best      : for every debit, pick the closest credit by
      //                     |posted_at| delta. Ties are broken deterministically
      //                     by smallest credit.id::text.
      //   credit_best     : symmetric — for every credit, pick the closest debit.
      //   mutual          : pairs that appear in BOTH best lists (mutual best
      //                     match). This collapses to a 1-to-1 mapping, so each
      //                     transaction appears in at most one pair.
      //   updated         : flag both legs and link transfer_pair_id atomically.
      const result = await db.execute<{ flagged: number }>(sql`
        WITH same_user_pairs AS (
          SELECT
            debit.id  AS debit_id,
            credit.id AS credit_id,
            ABS(EXTRACT(EPOCH FROM (debit.posted_at - credit.posted_at))) AS delta_seconds
          FROM ${transactions} debit
          INNER JOIN ${transactions} credit
            ON debit.user_id = credit.user_id
            AND debit.user_id = ${user_id}
            AND debit.is_transfer = false
            AND credit.is_transfer = false
            AND debit.type = 'DEBIT'
            AND credit.type = 'CREDIT'
            AND debit.account_id <> credit.account_id
            AND debit.amount = credit.amount
            AND ABS(EXTRACT(EPOCH FROM (debit.posted_at - credit.posted_at))) <= 3 * 24 * 60 * 60
        ),
        debit_best AS (
          SELECT debit_id, credit_id, delta_seconds
          FROM (
            SELECT
              debit_id, credit_id, delta_seconds,
              ROW_NUMBER() OVER (PARTITION BY debit_id ORDER BY delta_seconds ASC, credit_id::text ASC) AS rn
            FROM same_user_pairs
          ) ranked
          WHERE rn = 1
        ),
        credit_best AS (
          SELECT debit_id, credit_id, delta_seconds
          FROM (
            SELECT
              debit_id, credit_id, delta_seconds,
              ROW_NUMBER() OVER (PARTITION BY credit_id ORDER BY delta_seconds ASC, debit_id::text ASC) AS rn
            FROM same_user_pairs
          ) ranked
          WHERE rn = 1
        ),
        mutual AS (
          SELECT db.debit_id, db.credit_id
          FROM debit_best db
          INNER JOIN credit_best cb USING (debit_id, credit_id)
        ),
        updated AS (
          UPDATE ${transactions} t
          SET is_transfer = true,
              transfer_pair_id = CASE
                WHEN t.id = m.debit_id  THEN m.credit_id
                WHEN t.id = m.credit_id THEN m.debit_id
              END,
              updated_at = now()
          FROM mutual m
          WHERE t.id IN (m.debit_id, m.credit_id)
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
