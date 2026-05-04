---
phase: 02-pluggy-ingestion
plan: 13
status: completed
gap_closure: true
closes_reviews: [4]
completed: 2026-05-04
---

# Plan 02-13 — Deterministic transfer pairing

Closes 02-REVIEWS.md Concern #4 (HIGH).

## Outcome

Transfer detector now produces deterministic 1-to-1 pairs even under
ambiguity. Re-runs on identical data yield byte-identical
`transfer_pair_id` assignments. The 1-to-1 invariant is enforced by
mutual-best-match.

## Final SQL (5 CTEs)

```sql
WITH same_user_pairs AS (
  SELECT debit.id AS debit_id, credit.id AS credit_id,
         ABS(EXTRACT(EPOCH FROM (debit.posted_at - credit.posted_at))) AS delta_seconds
  FROM transactions debit
  INNER JOIN transactions credit
    ON debit.user_id = credit.user_id
    AND debit.user_id = $1
    AND debit.is_transfer = false
    AND credit.is_transfer = false
    AND debit.type = 'DEBIT' AND credit.type = 'CREDIT'
    AND debit.account_id <> credit.account_id
    AND debit.amount = credit.amount
    AND ABS(EXTRACT(EPOCH FROM (debit.posted_at - credit.posted_at))) <= 3 * 24 * 60 * 60
),
debit_best AS (
  SELECT debit_id, credit_id, delta_seconds
  FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY debit_id  ORDER BY delta_seconds ASC, credit_id::text ASC) AS rn FROM same_user_pairs) ranked
  WHERE rn = 1
),
credit_best AS (
  SELECT debit_id, credit_id, delta_seconds
  FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY credit_id ORDER BY delta_seconds ASC, debit_id::text  ASC) AS rn FROM same_user_pairs) ranked
  WHERE rn = 1
),
mutual AS (
  SELECT db.debit_id, db.credit_id
  FROM debit_best db INNER JOIN credit_best cb USING (debit_id, credit_id)
),
updated AS (
  UPDATE transactions t
  SET is_transfer = true,
      transfer_pair_id = CASE WHEN t.id = m.debit_id THEN m.credit_id WHEN t.id = m.credit_id THEN m.debit_id END,
      updated_at = now()
  FROM mutual m
  WHERE t.id IN (m.debit_id, m.credit_id)
  RETURNING t.id
)
SELECT count(*)::int AS flagged FROM updated;
```

## Test counts

- Before: 6 tests (transfer-1..6).
- After: 9 tests (6 original + 3 new determinism tests).
- Status: 9/9 GREEN in 4.85s.

## Driver-specific notes

The existing dual-shape unwrap for `db.execute()` was preserved unchanged
(`rows_arr[0]?.flagged ?? rows_obj.rows?.[0]?.flagged ?? 0`) — the new SQL
returns the same `{ flagged: count }` row shape, so no driver-specific
handling was needed.

## Commits

- `dd223fa` review(02-13): deterministic transfer pairing via mutual best match (codex #4)
