/**
 * Fatura Detector Worker — Plan 02-05 (TX-05, Pitfall P8) + Plan 02-14 (Concern #5).
 *
 * Identifies checking-account DEBIT transactions that represent a credit-card
 * fatura (invoice) payment. Sets `is_credit_card_payment=true` on matching rows.
 *
 * Heuristic (best-effort — see docs/specs/fatura-detection.md for the full
 * contract and known false-positive classes):
 *   A checking/savings DEBIT t is flagged iff:
 *   (a) |t.amount| equals the credit-card account's balance, AND
 *   (b) t.posted_at is within +/-7 days of the proximity anchor, where the
 *       anchor preferentially is `accounts.bill_due_date` (Pluggy
 *       `creditData.balanceDueDate`); falls back to `accounts.updated_at`
 *       only when bill_due_date IS NULL, AND
 *   (c) EXACTLY ONE active CREDIT_CARD account on the same user matches
 *       (multi-card-ambiguity guard — Concern #5 closure).
 *
 * Plan 02-14 — Concern #5 closure: Pluggy bill_due_date preferred + multi-card
 * ambiguity guard + per-anchor-source observability.
 *
 * Idempotency: `WHERE t.is_credit_card_payment = false` in the candidates CTE
 * excludes already-flagged rows — second run is always a no-op (T-02-F).
 *
 * Audit: `fatura_detected` is emitted only when count > 0 (D-13).
 *        `fatura_skipped reason=multi_card_ambiguity` emitted when ambiguous
 *        candidates were found (no row mutation).
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

type FaturaResultRow = {
  flagged: number;
  skipped_ambiguous: number;
  anchor_sources: string[] | null;
} & Record<string, unknown>;

export async function faturaDetectorWorker(jobs: Job<Payload>[]): Promise<void> {
  for (const job of jobs) {
    const user_id = job.data.user_id;
    try {
      const result = await db.execute<FaturaResultRow>(sql`
        WITH cc_balances AS (
          -- Concern #5 closure: prefer Pluggy creditData.balanceDueDate as
          -- proximity anchor. Falls back to accounts.updated_at when
          -- bill_due_date is NULL (older syncs or connectors that don't
          -- surface the field).
          SELECT
            a.id AS cc_account_id,
            a.user_id,
            a.balance,
            a.credit_limit,
            COALESCE(a.bill_due_date, a.updated_at) AS proximity_anchor,
            CASE
              WHEN a.bill_due_date IS NOT NULL THEN 'bill_due_date'
              ELSE 'accounts.updated_at_fallback'
            END AS anchor_source
          FROM ${accounts} a
          WHERE a.user_id = ${user_id}
            AND a.type = 'CREDIT_CARD'
            AND a.status = 'ACTIVE'
        ),
        candidates AS (
          SELECT
            t.id AS tx_id,
            t.amount AS tx_amount,
            cc.cc_account_id,
            cc.anchor_source
          FROM ${transactions} t
          INNER JOIN ${accounts} chk
            ON chk.id = t.account_id
            AND chk.type IN ('CHECKING', 'SAVINGS')
          INNER JOIN cc_balances cc
            ON cc.user_id = t.user_id
            AND cc.balance = t.amount
            AND ABS(EXTRACT(EPOCH FROM (t.posted_at - cc.proximity_anchor))) <= 7 * 24 * 60 * 60
          WHERE t.user_id = ${user_id}
            AND t.type = 'DEBIT'
            AND t.is_credit_card_payment = false
            AND t.is_transfer = false
        ),
        unambiguous AS (
          -- Concern #5 multi-card guard: only flag a debit if EXACTLY ONE
          -- credit card matches. If the same debit could plausibly settle 2+
          -- cards (same balance, both within window), do not auto-flag —
          -- surface in audit with reason for ops visibility. Phase 3 CAT-03
          -- will let the user manually mark which card.
          --
          -- MAX(anchor_source) is safe here: count(DISTINCT cc_account_id) = 1
          -- guarantees a single matching card, and anchor_source is a function
          -- of the card alone, so all rows in the group share the same value.
          SELECT tx_id,
                 MAX(anchor_source) AS anchor_source
          FROM candidates
          GROUP BY tx_id
          HAVING count(DISTINCT cc_account_id) = 1
        ),
        ambiguous AS (
          SELECT tx_id
          FROM candidates
          GROUP BY tx_id
          HAVING count(DISTINCT cc_account_id) > 1
        ),
        updated AS (
          UPDATE ${transactions} t
          SET is_credit_card_payment = true,
              updated_at = now()
          FROM unambiguous u
          WHERE t.id = u.tx_id
          RETURNING t.id, u.anchor_source
        )
        SELECT
          (SELECT count(*)::int FROM updated)            AS flagged,
          (SELECT count(*)::int FROM ambiguous)          AS skipped_ambiguous,
          (SELECT array_agg(anchor_source) FROM updated) AS anchor_sources
      `);

      // Drizzle execute() return shape differs by driver (see transferDetectorWorker.ts note).
      const rows_arr = result as unknown as FaturaResultRow[];
      const rows_obj = result as unknown as { rows: FaturaResultRow[] };
      const row = rows_arr[0] ?? rows_obj.rows?.[0];
      const flagged = row?.flagged ?? 0;
      const skipped_ambiguous = row?.skipped_ambiguous ?? 0;
      const anchor_sources: string[] = row?.anchor_sources ?? [];

      const billdate_count = anchor_sources.filter((s) => s === 'bill_due_date').length;
      const fallback_count = anchor_sources.filter(
        (s) => s === 'accounts.updated_at_fallback',
      ).length;

      logger.info(
        {
          event: 'fatura_detected',
          user_id_hashed: hashId(user_id),
          count: flagged,
          anchor_billdate: billdate_count,
          anchor_fallback: fallback_count,
          best_effort: true,
        },
        'fatura detector run (best-effort heuristic)',
      );

      if (skipped_ambiguous > 0) {
        logger.info(
          {
            event: 'fatura_skipped',
            reason: 'multi_card_ambiguity',
            user_id_hashed: hashId(user_id),
            count: skipped_ambiguous,
          },
          'fatura detector skipped ambiguous candidates — multiple cards match',
        );
      }

      if (flagged > 0) {
        await recordAudit({
          user_id,
          actor_type: 'SYSTEM',
          action: 'fatura_detected',
          metadata: {
            count: flagged,
            anchor_billdate: billdate_count,
            anchor_fallback: fallback_count,
            best_effort: true,
          },
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
