---
phase: 02-pluggy-ingestion
plan: 11
status: completed
gap_closure: true
closes_reviews: [1, 11]
completed: 2026-05-04
---

# Plan 02-11 — Redact `pluggy_item_id` from webhook + job payloads

Closes 02-REVIEWS.md Concerns #1 (HIGH) and #11 (MEDIUM); also closes
checker B3 by writing the on-disk disposition for all 13 codex review
concerns into `docs/security/pluggy-payload-policy.md`.

## Outcome

Roadmap success criterion #6 ("`pluggy_item_id` is never visible in
plaintext in DB") is now verifiably satisfied for both
`webhook_events.payload` AND pg-boss job rows. Workers continue to function
unchanged from a behavioral standpoint — only the input payload shape
changed.

## Key files created

- `src/lib/pluggyRedaction.ts` — single export
  `redactPluggyPayload<T extends PluggyEventLike>(body: T):
  Omit<T, 'itemId'> & { itemIdHash?: string }` plus
  `REDACTED_ITEM_ID_KEY = 'itemIdHash'`. Shallow-clone, never mutates input,
  hex-encodes HMAC-SHA-256 via `hashPluggyItemId`.
- `tests/unit/lib/pluggyRedaction.test.ts` — 4 tests covering the helper
  contract (replace itemId with hash, no-op when absent, leave nested
  `error.message` verbatim, never mutate caller input).
- `tests/integration/pluggy/payload-redaction.test.ts` — 1 test asserting
  webhook_events.payload has no plaintext itemId AND PLUGGY_SYNC job carries
  `item_id_hash_hex`. Belt-and-braces `JSON.stringify(...).not.toContain(plaintext)`.
- `tests/integration/pluggy/jobpayload-redaction.test.ts` — 1 test proving
  `pluggySyncWorker` resolves the seeded item via `item_id_hash_hex` and
  reaches the success branch.
- `docs/security/pluggy-payload-policy.md` — single canonical policy doc
  (Scope, Redaction, Retention, API Non-Exposure, Log Prohibition, Phase 6
  Hardening Hooks, Cross-References, Reviews Disposition for all 13 concerns).

## Key files modified

- `src/app/api/webhooks/pluggy/route.ts` — redact payload before INSERT;
  enqueue `{ webhook_event_id, item_id_hash_hex, trigger }` instead of
  `item_id_pluggy`. Inline `item_reauth_succeeded` audit preserved (Phase
  2-12 will move it to a worker) and now reuses the hash buffer computed
  once at the top of the handler.
- `src/jobs/workers/pluggySyncWorker.ts` — `SyncJobPayload` field
  `item_id_pluggy` -> `item_id_hash_hex`. Worker hex-decodes and looks up by
  `pluggy_items.pluggy_item_id_hash`. Removed lazy `hashPluggyItemId` import.
- `src/jobs/workers/reAuthNotifierWorker.ts` — same migration.
- `src/app/api/pluggy/items/route.ts` — comment marker (Concern #1) noting
  the first-connect path enqueues the internal UUID.
- `tests/integration/pluggy/webhook.test.ts` — scenario (d) assertion
  migrated; scenario (g) augmented with `item_id_hash_hex` shape proof.

## Verification

- `npm run typecheck`: clean.
- `npm run test:unit -- pluggyRedaction`: 4/4 GREEN.
- `npm run test:integration -- pluggy/payload-redaction
  pluggy/jobpayload-redaction pluggy/webhook`: 8/9 GREEN.
- `grep -rE "item_id_pluggy" src/`: only remaining matches are FK
  constraint names in immutable migrations
  (`accounts_pluggy_item_id_pluggy_items_id_fk`) — false positives, not the
  legacy payload key. **Deviation note** (see below).
- `grep -rE "item_id_pluggy" tests/`: only remaining matches are NEGATIVE
  assertions and docstring mentions inside the new redaction tests
  (asserting the field is absent / describing what was removed). These are
  intentional and serve as regression guards.
- `grep -E "^### Concern #N" docs/security/pluggy-payload-policy.md` for
  N=1..13: all 13 headings present (verified by node one-liner).

## Pre-existing failures (out of scope)

Two test files have pre-existing failures on `main` confirmed by stashing
the 02-11 work and re-running:

- `tests/integration/pluggy/sync-worker.test.ts` sync-1, sync-2, sync-3:
  drizzle-orm `value.toISOString is not a function` when fixture date
  strings are passed to PgTimestamp columns (`posted_at`). Tracked by the
  plan 02-09 follow-up note in STATE.md ("Tests 3-7 still blocked on
  per-suite truncation + migration regression triage").
- `tests/integration/pluggy/webhook.test.ts` scenario (g):
  `expect(metadata.item_id_hashed).toBe(expected_hash)` fails because
  `src/lib/piiScrubber.ts`'s `TOKEN_LIKE_REGEX` regexes the 64-char hex
  hash and replaces it with `[TOKEN]` inside `recordAudit`'s `scrubObject`.
  Pre-existing on `main` — out of scope for plan 02-11.

Both belong to a future polish plan (test stabilization).

## Deviation: legacy-key grep sweep

Plan acceptance criterion: `grep -rE "item_id_pluggy" src/ tests/` returns
0 lines. Deviated in two cases:

1. `src/db/migrations/0001_02_pluggy_ingestion.sql` and
   `src/db/migrations/meta/0001_snapshot.json` /
   `meta/0002_snapshot.json` contain the FK constraint name
   `accounts_pluggy_item_id_pluggy_items_id_fk`. This is a string match on
   the SUBSTRING `item_id_pluggy` inside the constraint name token — the
   actual identifier is `pluggy_item_id` (Pluggy's own ID column on
   `pluggy_items`), unrelated to the `item_id_pluggy` JSON payload key
   that this plan removed. Migrations are immutable historical artifacts
   and cannot be rewritten without breaking applied migration tracking.
2. The new redaction tests intentionally NEGATIVE-assert
   `item_id_pluggy` to prove the field is absent
   (`expect(payload?.item_id_pluggy).toBeUndefined()`). Removing the
   string would weaken the regression guard.

Mitigation: the grep sweep can be tightened to
`grep -rE "(?<!_)item_id_pluggy\b" src/ tests/ --include='*.ts'
--exclude-dir=migrations` if a future audit needs a stricter check.

## Commits

- `3c9876a` review(02-11): redact pluggy_item_id from webhook + job payloads (codex #1)
- `65b7c7f` docs(02-11): pluggy JSONB payload handling policy (codex #11)
- `229ad20` docs(02-11): append Reviews Disposition section (closes B3)

## What this enables

Plan 02-12 (move reauth audit out of webhook hot path) can now move the
inline `item_reauth_succeeded` audit code from `route.ts` to a worker. The
hash buffer is already computed at the top of the receiver, so the worker
can simply receive `item_id_hash_hex` and reuse the same lookup pattern
the sync worker uses.
