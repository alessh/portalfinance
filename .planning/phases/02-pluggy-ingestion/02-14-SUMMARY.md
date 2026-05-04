---
phase: 02-pluggy-ingestion
plan: 14
type: summary
status: complete
gap_closure: true
closes_reviews: [5]
---

# Plan 02-14 Summary — Fatura Detector Best-Effort Hardening (Concern #5)

## Outcome

Closed codex review concern **#5 (HIGH)**. The fatura detector now prefers
Pluggy's `creditData.balanceDueDate` as the proximity anchor instead of the
local `accounts.updated_at` sync timestamp, and refuses to auto-flag when 2+
credit-card candidates match the same debit (multi-card ambiguity). Per-flag
observability surfaces the anchor source for ops monitoring.

## Migration

- New migration `0004_phase02_14_accounts_bill_due_date.sql`:
  ```sql
  ALTER TABLE "accounts" ADD COLUMN "bill_due_date" timestamp with time zone;
  ```
- Applied to dev DB via `pnpm db:migrate` (project bans `drizzle-kit push` per
  `drizzle.config.ts` — comment cites RESEARCH.md pitfall about losing
  migration history).

## Final SQL (faturaDetectorWorker.ts)

```sql
WITH cc_balances AS (
  -- Concern #5: prefer Pluggy bill_due_date; fall back to updated_at when NULL.
  SELECT
    a.id AS cc_account_id, a.user_id, a.balance, a.credit_limit,
    COALESCE(a.bill_due_date, a.updated_at) AS proximity_anchor,
    CASE
      WHEN a.bill_due_date IS NOT NULL THEN 'bill_due_date'
      ELSE 'accounts.updated_at_fallback'
    END AS anchor_source
  FROM "accounts" a
  WHERE a.user_id = $1 AND a.type = 'CREDIT_CARD' AND a.status = 'ACTIVE'
),
candidates AS (
  SELECT t.id AS tx_id, t.amount AS tx_amount, cc.cc_account_id, cc.anchor_source
  FROM "transactions" t
  INNER JOIN "accounts" chk ON chk.id = t.account_id AND chk.type IN ('CHECKING','SAVINGS')
  INNER JOIN cc_balances cc
    ON cc.user_id = t.user_id
    AND cc.balance = t.amount
    AND ABS(EXTRACT(EPOCH FROM (t.posted_at - cc.proximity_anchor))) <= 7 * 24 * 60 * 60
  WHERE t.user_id = $2 AND t.type = 'DEBIT'
    AND t.is_credit_card_payment = false AND t.is_transfer = false
),
unambiguous AS (
  -- Multi-card guard: only flag when EXACTLY ONE card matches.
  SELECT tx_id, MAX(anchor_source) AS anchor_source
  FROM candidates
  GROUP BY tx_id
  HAVING count(DISTINCT cc_account_id) = 1
),
ambiguous AS (
  SELECT tx_id FROM candidates GROUP BY tx_id HAVING count(DISTINCT cc_account_id) > 1
),
updated AS (
  UPDATE "transactions" t
  SET is_credit_card_payment = true, updated_at = now()
  FROM unambiguous u WHERE t.id = u.tx_id
  RETURNING t.id, u.anchor_source
)
SELECT
  (SELECT count(*)::int FROM updated)            AS flagged,
  (SELECT count(*)::int FROM ambiguous)          AS skipped_ambiguous,
  (SELECT array_agg(anchor_source) FROM updated) AS anchor_sources;
```

## Sync Worker Change (`pluggySyncWorker.ts`)

Account upsert now persists `bill_due_date` from `creditData.balanceDueDate`:

```ts
bill_due_date:
  a.creditData?.balanceDueDate != null
    ? a.creditData.balanceDueDate instanceof Date
      ? a.creditData.balanceDueDate
      : new Date(a.creditData.balanceDueDate)
    : null,
// onConflictDoUpdate.set:
bill_due_date: sql.raw('excluded.bill_due_date'),
```

Defensive `instanceof Date` check accommodates both the SDK's typed Date
return shape and JSON-fixture string inputs.

## Tests — 11/11 Passing

`tests/integration/services/FaturaDetector.test.ts`:

| Test | Purpose | Result |
|------|---------|--------|
| fatura-1 | Original — flag debit matching CC balance within ±7d | ✓ |
| fatura-2 | Original — amount mismatch → no flag | ✓ |
| fatura-3 | Original — idempotent re-run | ✓ |
| fatura-4 | Original — outside ±7d window → no flag | ✓ |
| fatura-fp-1 | Same-amount purchase to non-card account (residual FP, documented) | ✓ |
| fatura-fp-2 | Pre-flagged transfer is excluded by detector | ✓ |
| fatura-fp-3 | Partial card payment (debit < balance) → no flag | ✓ |
| fatura-fp-4 | Overpayment (debit > balance) → no flag | ✓ |
| fatura-fp-5 | Multi-card ambiguity → no flag, no audit row | ✓ |
| fatura-billdate-anchor | bill_due_date preferred over updated_at; audit metadata anchor_billdate=1 | ✓ |
| fatura-fallback-anchor | Falls back to updated_at when bill_due_date IS NULL; audit metadata anchor_fallback=1 | ✓ |

```
Test Files  1 passed (1)
     Tests  11 passed (11)
  Duration  9.28s
```

## Anchor Source Distribution (test runs)

Across the 11 fatura tests, the detector emitted anchor counts as follows
(from log output):

- `anchor_billdate=1, anchor_fallback=0`: 1 run (fatura-billdate-anchor — only
  run that seeds a non-NULL bill_due_date).
- `anchor_billdate=0, anchor_fallback=1`: 5 runs (fatura-1, fatura-3 first
  pass, fatura-fp-1, fatura-fp-2 first pass, fatura-fallback-anchor).
- `anchor_billdate=0, anchor_fallback=0`: 5 runs (no-flag scenarios).

Production telemetry will surface this same distribution per user across
`event=fatura_detected` log entries — ops should monitor the
`billdate / (billdate + fallback)` ratio as a connector-coverage health
indicator. A persistently low ratio is a Phase 6 trigger to invest in the
bill-line-item evidence upgrade.

## Build

- `pnpm db:migrate` — exit 0 (migration applied).
- `pnpm test:integration tests/integration/services/FaturaDetector.test.ts` — 11/11 pass.
- `pnpm build` — exit 0 (no type errors after `Record<string, unknown>` constraint added to `FaturaResultRow`).

## Spec Doc

Created `docs/specs/fatura-detection.md` documenting:

- The exact rule in plain English.
- 5 known residual false-positive classes (same-amount purchase, coincidental
  match, stale balance, cross-bank fatura via non-tracked account, joint
  accounts).
- Phase 6 follow-up actions.
- Logging contract for `event=fatura_detected` and `event=fatura_skipped`.

## Files Modified / Created

- `src/db/schema/accounts.ts` (added `bill_due_date` column)
- `src/db/migrations/0004_phase02_14_accounts_bill_due_date.sql` (new)
- `src/db/migrations/meta/0004_snapshot.json` (auto-generated)
- `src/db/migrations/meta/_journal.json` (auto-updated)
- `src/jobs/workers/pluggySyncWorker.ts` (upsert populates bill_due_date)
- `src/jobs/workers/faturaDetectorWorker.ts` (full rewrite of SQL + observability)
- `tests/integration/services/FaturaDetector.test.ts` (+7 tests, +1 helper)
- `docs/specs/fatura-detection.md` (new spec doc)
