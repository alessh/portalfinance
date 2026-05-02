/**
 * Fatura Detector Worker — Plan 02-05 (TX-05, Pitfall P8).
 *
 * Identifies checking-account DEBIT transactions that represent a credit-card
 * fatura (invoice) payment. Sets `is_credit_card_payment=true` on matching rows.
 *
 * Heuristic (P8 / TX-05):
 *   A checking-account DEBIT t is flagged iff:
 *   (a) |t.amount| equals the credit-card account's balance at sync time, AND
 *   (b) t.posted_at is within +/-7 days of the credit-card account's
 *       accounts.updated_at (used as a billing-cycle close proxy), AND
 *   (c) both the debit and the credit-card account belong to the same user_id.
 *
 * Phase 6 follow-up (verbatim, per checker disposition):
 *   "TX-05 fatura precision — extend with Pluggy `creditData.balanceDueDate`
 *   (and optionally `balanceCloseDate`) when those fields become reliably
 *   populated; tighten the proximity window from +/-7 days to +/-3 days around
 *   the actual due date."
 *
 * Fallback (documented inline below — NOT active in Phase 2):
 *   If accounts.updated_at proves an unreliable billing-cycle proxy, the
 *   window can be widened to +/-10 days. Additionally, a DEBIT-aggregate sum
 *   equality check on the credit-card account within the same window can
 *   substitute for the balance equality check. This fallback is left as an
 *   inline comment so future maintainers can enable it without re-litigating
 *   the Phase 2 heuristic design.
 *
 * Idempotency: `WHERE t.is_credit_card_payment = false` in the candidates CTE
 * excludes already-flagged rows — second run is always a no-op (T-02-F).
 *
 * Audit: `fatura_detected` is emitted only when count > 0 (D-13).
 * PII contract: only hashed user_id appears in logs (P13 / Pattern S7).
 */
import type { Job } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { accounts, transactions } from '@/db/schema';
import { logger } from '@/lib/logger';
import { hashUserIdForSentry as hashId } from '@/lib/sentry';
import { recordAudit } from '@/lib/auditLog';

interface Payload {
  user_id: string;
}

export async function faturaDetectorWorker(jobs: Job<Payload>[]): Promise<void> {
  for (const job of jobs) {
    const user_id = job.data.user_id;
    try {
      // P8 / TX-05: a checking-account DEBIT t1 is flagged is_credit_card_payment=true iff:
      //   (a) |t1.amount| equals the credit-card account's balance at sync time (Pluggy
      //       reports credit-card balance as the outstanding invoice amount), AND
      //   (b) t1.posted_at is within +/-7 days of the credit-card account's
      //       accounts.updated_at (Phase 2 billing-cycle proximity proxy), AND
      //   (c) the credit-card account belongs to the same user_id (already enforced by scope).
      //
      // Fallback (10-day window with aggregate sum equality check — left as comment block for
      // Phase 6 maintainers; enable by changing 7 to 10 in the EXTRACT condition below AND
      // adding: AND cc.balance = (SELECT SUM(t2.amount) FROM transactions t2
      //   WHERE t2.account_id = cc.cc_account_id AND t2.type = 'DEBIT'
      //   AND ABS(EXTRACT(EPOCH FROM (t2.posted_at - cc.cc_updated_at))) <= 10 * 24 * 60 * 60)):
      //   Use this fallback if accounts.updated_at proves unreliable as a billing proxy.
      //   Phase 6 will replace with Pluggy creditData.balanceDueDate / balanceCloseDate.
      const result = await db.execute<{ flagged: number }>(sql`
        WITH cc_balances AS (
          SELECT
            a.id               AS cc_account_id,
            a.user_id,
            a.balance,
            a.credit_limit,
            a.updated_at       AS cc_updated_at
          FROM ${accounts} a
          WHERE a.user_id = ${user_id}
            AND a.type = 'CREDIT_CARD'
            AND a.status = 'ACTIVE'
        ),
        candidates AS (
          SELECT t.id AS tx_id
          FROM ${transactions} t
          INNER JOIN ${accounts} chk
            ON chk.id = t.account_id
            AND chk.type IN ('CHECKING', 'SAVINGS')
          INNER JOIN cc_balances cc
            ON cc.user_id = t.user_id
            AND cc.balance = t.amount
            -- (b) +/-7-day proximity using accounts.updated_at as the billing-cycle proxy.
            -- Fallback: widen to 10 * 24 * 60 * 60 (10-day) + DEBIT-aggregate sum equality
            -- (see module-level comment above) for accounts.updated_at-unavailable case.
            AND ABS(EXTRACT(EPOCH FROM (t.posted_at - cc.cc_updated_at))) <= 7 * 24 * 60 * 60
          WHERE t.user_id = ${user_id}
            AND t.type = 'DEBIT'
            AND t.is_credit_card_payment = false
            AND t.is_transfer = false
        ),
        updated AS (
          UPDATE ${transactions} t
          SET is_credit_card_payment = true,
              updated_at = now()
          FROM candidates c
          WHERE t.id = c.tx_id
          RETURNING t.id
        )
        SELECT count(*)::int AS flagged FROM updated
      `);

      // Drizzle execute() return shape differs by driver (see transferDetectorWorker.ts note).
      const rows_arr = (result as unknown as Array<{ flagged: number }>);
      const rows_obj = (result as unknown as { rows: Array<{ flagged: number }> });
      const flagged = rows_arr[0]?.flagged ?? rows_obj.rows?.[0]?.flagged ?? 0;

      logger.info(
        {
          event: 'fatura_detected',
          user_id_hashed: hashId(user_id),
          count: flagged,
        },
        'fatura detector run',
      );

      if (flagged > 0) {
        await recordAudit({
          user_id,
          actor_type: 'SYSTEM',
          action: 'fatura_detected',
          metadata: { count: flagged },
        });
      }
    } catch (err) {
      logger.error(
        {
          event: 'worker_job_failed',
          job_id: job.id,
          worker: 'faturaDetector',
          error: String(err),
        },
        'Job processing failed — pg-boss will retry',
      );
      throw err;
    }
  }
}
