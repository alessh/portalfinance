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

---

## Reviews Disposition

**Audit trail:** for each codex review concern raised in
`.planning/phases/02-pluggy-ingestion/02-REVIEWS.md`, this table records
WHICH plan closes it OR — for "non-issue" determinations — the rationale
and the on-disk evidence that supports the determination. Auditors can grep
this section by `Concern #N` and trace to the closing artifact.

### Concern #1 — RESOLVED by plan 02-11
HIGH severity. Plaintext `pluggy_item_id` leakage into `webhook_events.payload`
and pg-boss job payloads.
**Evidence:** `src/lib/pluggyRedaction.ts` (created Task 1 of this plan);
`src/app/api/webhooks/pluggy/route.ts` (redaction applied before INSERT and
enqueue); `tests/integration/pluggy/payload-redaction.test.ts`,
`tests/integration/pluggy/jobpayload-redaction.test.ts`.

### Concern #2 — RESOLVED by plan 02-17
HIGH severity. Success criterion #1 (sandbox connect → transactions visible
in 60s) was asserted by mocked E2E only.
**Evidence:** `.github/workflows/pluggy-sandbox-nightly.yml` +
`tests/e2e/pluggy/sandbox-connect.spec.ts` provide the real-sandbox CI gate.

### Concern #3 — RESOLVED by plan 02-12
HIGH severity. Webhook handler did too much in the hot path for
`item/login_succeeded`.
**Evidence:** `src/jobs/workers/itemReauthSucceededAuditWorker.ts`; receiver
inline audit removed; latency regression test in
`tests/integration/pluggy/webhook-latency.test.ts`.

### Concern #4 — RESOLVED by plan 02-13
HIGH severity. Transfer detection over-paired ambiguous transactions.
**Evidence:** `src/jobs/workers/transferDetectorWorker.ts` (mutual best-match
CTE with 1-to-1 invariant); `tests/integration/services/TransferDetector.test.ts`
(ambiguity tests).

### Concern #5 — RESOLVED by plan 02-14
HIGH severity. Fatura detector heuristic was too weak for real-world
correctness.
**Evidence:** `src/db/schema/accounts.ts` adds `bill_due_date`;
`src/jobs/workers/faturaDetectorWorker.ts` prefers Pluggy
`creditData.balanceDueDate` + multi-card ambiguity guard;
`docs/specs/fatura-detection.md` documents best-effort semantics.

### Concern #6 — RESOLVED by plan 02-15
MEDIUM severity. Broken-item state taxonomy was inconsistent — OUTDATED
treated inconsistently across the codebase.
**Evidence:** `src/lib/pluggyItemStatus.ts` (centralized
`isSyncableItemStatus` / `needsReauth` helpers); grep sweep enforces zero
direct status string comparisons in workers/routes.

### Concern #7 — RESOLVED by plan 02-15
MEDIUM severity. `pluggy_items` lacked an explicit DISCONNECTED/DELETED
lifecycle state.
**Evidence:** `item_status_enum` extended with `'DISCONNECTED'`; disconnect
route sets it atomically with accounts soft-delete and consent revocation;
reconcile cron and sync worker honor the terminal state.

### Concern #8 — RESOLVED by plan 02-16
MEDIUM severity. pg-boss singleton semantics may not dedupe queued backlog
as intended.
**Evidence:** `tests/integration/jobs/pg-boss-singleton.test.ts` (empirical
verification of dedupe under concurrent enqueues); plan 02-16 PLAN.md.

### Concern #9 — DISPOSED — non-issue
Original codex concern: "`src/lib/serverOnly.ts` design (Module._cache stub
or monkey-patch of `'server-only'`) is over-engineered; the standard
`'server-only'` package export is sufficient for the intended boundary."

**Disposition rationale:** the as-shipped code in `src/lib/serverOnly.ts`
ALREADY matches the alternative the reviewer suggested. Specifically:

1. There is NO `Module._cache` stub in the current file. Commit `67f6222`
   ("test(setup): strip Module._cache stub; rollback vi.mock with deeper
   @/lib/serverOnly mock") explicitly stripped any leftover stub.
2. There is NO monkey-patch of the `'server-only'` package. Commit
   `1039518` ("fix(lib): drop top-level 'server-only' import from
   serverOnly.ts (tsx crash)") further dropped the top-level import that
   broke tsx subprocess boot.
3. The current implementation is the minimum viable boundary: a typeof-
   window runtime check that throws only in genuine browser contexts; plain
   Node/tsx callers (worker, db:migrate, e2e runner, ad-hoc scripts) pass
   through silently.

**On-disk evidence:** read `src/lib/serverOnly.ts` directly; the file is
short and self-evident. Commits `67f6222` (Apr 2026) and `1039518` (May
2026) document the simplification path. No further code change is required
for Concern #9.

**Tracking:** if a future reviewer disagrees with this disposition,
escalate by opening a new entry in 02-REVIEWS.md and a follow-up plan; do
NOT silently re-introduce a stub.

### Concern #10 — RESOLVED by plan 02-16
MEDIUM severity. Route tests relied on brittle `vi.mock` ordering that
conflicted with 02-09's singleton testcontainer rationale.
**Evidence:** `tests/integration/pluggy/route-mock-stability.test.ts`
(canonical `vi.doMock` pattern); `docs/testing/pluggy-test-conventions.md`
documents the convention; plan 02-16 PLAN.md.

### Concern #11 — RESOLVED by plan 02-11
MEDIUM severity. Sensitive JSONB payloads with no documented
retention/redaction/log-prohibition policy.
**Evidence:** THIS DOCUMENT (`docs/security/pluggy-payload-policy.md`).

### Concern #12 — RESOLVED by plan 02-18
LOW severity. `last_synced_at` as the manual-sync cooldown anchor was blunt.
**Evidence:** `src/db/schema/pluggyItems.ts` adds `last_manual_sync_at`;
`src/jobs/workers/pluggySyncWorker.ts` writes it ONLY on
`trigger='manual'` success; `src/app/api/pluggy/items/[id]/sync/route.ts`
cooldown reads it; `tests/integration/pluggy/cooldown.test.ts` covers
manual / webhook / failed scenarios.

### Concern #13 — RESOLVED by plan 02-17
LOW severity. Missing Playwright screenshot smoke for `/transactions` and
`/settings/connections` states.
**Evidence:** `tests/e2e/pluggy/screenshots-transactions.spec.ts`,
`tests/e2e/pluggy/screenshots-connections.spec.ts`, wired into the nightly
workflow with artifact upload.

### Coverage Audit

| Concern # | Severity | Disposition | Closing Plan |
|-----------|----------|-------------|--------------|
| 1 | HIGH | RESOLVED | 02-11 |
| 2 | HIGH | RESOLVED | 02-17 |
| 3 | HIGH | RESOLVED | 02-12 |
| 4 | HIGH | RESOLVED | 02-13 |
| 5 | HIGH | RESOLVED | 02-14 |
| 6 | MEDIUM | RESOLVED | 02-15 |
| 7 | MEDIUM | RESOLVED | 02-15 |
| 8 | MEDIUM | RESOLVED | 02-16 |
| 9 | (n/a) | DISPOSED — non-issue | — (see rationale above) |
| 10 | MEDIUM | RESOLVED | 02-16 |
| 11 | MEDIUM | RESOLVED | 02-11 |
| 12 | LOW | RESOLVED | 02-18 |
| 13 | LOW | RESOLVED | 02-17 |

All 13 concerns accounted for. No silent omissions.
