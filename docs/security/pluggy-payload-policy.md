# Pluggy JSONB Payload Handling Policy

**Status:** ACTIVE
**Owner:** Engineering — Phase 2 ownership; Phase 6 review
**Closes:** 02-REVIEWS.md Concern #11

## Scope

This policy governs two JSONB columns that store Pluggy-derived data in plaintext at rest:

1. `webhook_events.payload` — the full Pluggy webhook body, persisted by the
   receiver after redaction (see [Redaction](#redaction-already-in-force)).
2. `transactions.raw_payload` — the full Pluggy transaction object as returned
   by `transactions-list-by-cursor`, persisted by `pluggySyncWorker`.

Neither column is encrypted at rest in Phase 2. Both columns contain
financial signal that must not be exposed via API, leaked into logs, or
retained beyond its operational purpose.

## Redaction (already in force)

- `webhook_events.payload` has the top-level `itemId` REPLACED with `itemIdHash`
  (lower-hex of HMAC-SHA-256 via `hashPluggyItemId` and the
  `PLUGGY_ITEM_ID_HASH_PEPPER`) at receiver time. Helper:
  `src/lib/pluggyRedaction.ts`. Closes Concern #1.
- pg-boss job payloads carry either `item_id_hash_hex` (webhook-driven path)
  or the internal `pluggy_items.id` UUID (first-connect path). The Pluggy
  plaintext `pluggy_item_id` NEVER appears in pg-boss job rows.
- `transactions.raw_payload` is NOT redacted in Phase 2. It does not carry the
  encrypted-at-rest `pluggy_item_id`, but it does contain merchant CNPJ,
  free-form descriptions, and amount.
- Phase 2 redaction is a SHALLOW replacement of the top-level `itemId` only.
  Nested fields (e.g., `error.message`) are persisted verbatim. Field-level
  scrub of nested strings is scheduled for Phase 6.

## Retention

| Column | Retention | Rationale |
|--------|-----------|-----------|
| `webhook_events.payload` | 30 days | Required for replay debugging during Pluggy's 9-attempt retry window (max 2h) plus an ops triage buffer. After 30 days the `event_id` row may stay (idempotency anchor) but the `payload` column is set to NULL. |
| `transactions.raw_payload` | 12 months | Aligned with the maximum sync depth (D-26). The Phase 6 LGPD deletion workflow handles per-user wipe earlier on user request. |

Implementation note: a Phase 6 cron will run a retention sweep over both
columns. Phase 2 documents the policy; the sweep ships with Phase 6 OPS-04
hardening.

## API Non-Exposure

The following columns MUST NOT be returned by any HTTP route, server action,
or RSC fetch:

- `webhook_events.*` — the entire table is internal-only. Admin views land in
  Phase 6.
- `transactions.raw_payload` — exposed columns are limited to `id`,
  `account_id`, `type`, `amount`, `currency`, `description`, `posted_at`,
  `status`, `is_transfer`, `is_credit_card_payment`, `transfer_pair_id`,
  `payment_method`.

Enforcement: every route that selects from `transactions` MUST use an
explicit `select({ ... })` projection that omits `raw_payload`. Routes that
`select * from transactions` are forbidden. Code review and the Phase 6 lint
rule below are the enforcement gates.

## Log Prohibition

The following MUST NEVER appear as a structured log field name OR as part of
an interpolated message string:

- `payload` (when referring to `webhook_events.payload`)
- `raw_payload`
- `itemId` (the Pluggy plaintext)
- `pluggy_item_id`
- transaction `description`, `description_raw`, `merchant_name`,
  `merchant_cnpj`, `amount`

Allowed: `event_type`, `was_duplicate`, `latency_ms`, hashed identifiers
(`user_id_hashed`, `item_id_hashed`), counts (`transactions_added`).

Violation surfaces: Phase 6 will add a lint rule that scans `logger.*` calls
for prohibited field names. Phase 2 enforces the rule by code review and the
existing pino redaction list in `src/lib/logger.ts`.

## Phase 6 Hardening Hooks

- Encrypt `webhook_events.payload` at rest (D-40 deferral acknowledged).
- Field-level scrub of nested `error.message` strings in webhook payloads.
- Per-user retention sweep cron that NULLs `webhook_events.payload` after 30
  days and `transactions.raw_payload` after 12 months.
- Lint rule for `logger.*` argument shapes that flags the Phase 2 prohibited
  field names above.

## Cross-References

- Concern #1: `src/lib/pluggyRedaction.ts`,
  `src/app/api/webhooks/pluggy/route.ts` (plan 02-11 Task 1).
- D-40: `02-CONTEXT.md` (webhook_events.payload encryption deferred to Phase 6).
- P13: `.planning/research/PITFALLS.md` (PII in logs).
- LGPD-04: full deletion workflow (Phase 6).
