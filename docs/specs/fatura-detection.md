# Fatura Detection — Phase 2 Best-Effort Spec

**Status:** ACTIVE — best-effort
**Closes:** `.planning/phases/02-pluggy-ingestion/02-REVIEWS.md` Concern #5
**Owner:** Phase 2 → Phase 6 follow-up
**Plan:** `.planning/phases/02-pluggy-ingestion/02-14-PLAN.md`

## Context

The fatura (credit-card invoice) detector flips `transactions.is_credit_card_payment = true`
on a checking/savings DEBIT row when that debit looks like it settled a credit-card balance.
Why this matters: Phase 3 dashboard aggregates exclude `is_credit_card_payment = true` rows so
that a card statement payment doesn't double-count against the user's monthly spend (the
underlying card-line-item charges are already aggregated separately).

## Rule

A `transactions` row is flagged `is_credit_card_payment = true` IFF all of:

1. `t.type = 'DEBIT'` AND `t.is_transfer = false` AND `t.is_credit_card_payment = false`.
2. The source account is `CHECKING` or `SAVINGS`.
3. There is **EXACTLY ONE** active `CREDIT_CARD` account on the same user where:
   - `cc.balance = t.amount`, AND
   - `|t.posted_at - COALESCE(cc.bill_due_date, cc.updated_at)| <= 7 days`.

The proximity anchor is preferentially `accounts.bill_due_date` (populated from
Pluggy `creditData.balanceDueDate` on each sync). When NULL, falls back to
`accounts.updated_at` (sync time — known imprecise; documented as fallback).

Multi-card ambiguity → conservative no-flag (Phase 3 CAT-03 lets the user manually mark).
Pre-flagged transfers (`is_transfer = true`, set by `transferDetectorWorker` which runs
first) are excluded by the WHERE clause.

## Known False Positives (residual after Phase 2 fixes)

These cases will silently flag despite the multi-card guard:

1. **Same-amount purchase to non-card account.** A 890 debit for groceries on the
   same day a card has a 890 balance → flags. Mitigation: user manually un-flags
   in Phase 3 CAT-03 (transaction edit UI).
2. **Coincidental amount match within window across unrelated transactions** —
   same shape as #1; conservatism limited by single-card requirement.
3. **Card balance unchanged after fatura paid.** If Pluggy hasn't re-synced the
   card between payment and our run, the card may still report the pre-payment
   balance — multiple debits could match. Mitigated partially by the 7-day
   window plus the single-card guard.
4. **Cross-bank fatura payments via boleto/PIX where source is a non-tracked
   account.** No detection (we only see what's connected).
5. **Joint accounts where one user pays the card, another is the cardholder.**
   Different `user_id`; correctly NOT flagged (scoped by `user_id`).

## Phase 6 Follow-up

- Move from balance-equality to bill-line-item evidence (Pluggy bill API).
- Tighten window to ±3 days around actual `bill_due_date` (currently ±7 for
  fallback safety with the imprecise `accounts.updated_at` anchor).
- Promote user override surface (CAT-03 in Phase 3 already covers this — the
  data plumbing exists by Phase 6).

## Logging Contract

Every detector run emits:

```jsonc
{
  "event": "fatura_detected",
  "user_id_hashed": "<hash>",
  "count": <int>,
  "anchor_billdate": <int>,        // count of flags using bill_due_date
  "anchor_fallback": <int>,        // count of flags using updated_at fallback
  "best_effort": true              // explicit best-effort marker
}
```

Ambiguity skips emit:

```jsonc
{
  "event": "fatura_skipped",
  "reason": "multi_card_ambiguity",
  "user_id_hashed": "<hash>",
  "count": <int>
}
```

Audit (`audit_log.action = 'fatura_detected'`) carries the same `anchor_billdate`,
`anchor_fallback`, `count`, and `best_effort` keys in `metadata`.

Ops dashboards should monitor the ratio `anchor_billdate / (anchor_billdate + anchor_fallback)`
as a connector-coverage metric — a sustained low ratio signals connectors that
do not surface `creditData.balanceDueDate` and would benefit from the Phase 6
bill-line-item upgrade.
