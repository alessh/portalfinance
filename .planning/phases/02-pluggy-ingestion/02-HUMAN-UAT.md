---
status: partial
phase: 02-pluggy-ingestion
source: [02-VERIFICATION.md]
started: 2026-05-02T13:00:00Z
updated: 2026-05-02T15:40:00Z
---

## Current Test

[testing paused — 2 blockers found; 5 remaining tests blocked by shared infrastructure failures pending fix]

## Tests

### 1. End-to-end connect flow against Pluggy sandbox (criterion 1)
expected: User opens `/connect`, grants consent, completes Pluggy Connect for a sandbox bank, and within 60 seconds sees accounts and transactions on `/transactions`.
why_human: Live Pluggy sandbox credentials + running Next.js server + running pg-boss worker + 60s timing window.
how: Set `PLUGGY_SANDBOX_CLIENT_ID` / `PLUGGY_SANDBOX_CLIENT_SECRET` in `.env`, run `pnpm dev` and `pnpm start:worker`, sign in, navigate `/connect`.
result: issue
reported: "Runtime ZodError on /connect — env validation fails at module evaluation: NODE_ENV invalid (received undefined or unexpected value), DATABASE_URL undefined, NEXTAUTH_SECRET undefined, ENCRYPTION_KEY undefined, CPF_HASH_PEPPER undefined. Crash thrown from ConnectIsland import chain (src/app/connect/page.tsx:142). Next.js 16.2.4 Turbopack dev server."
severity: blocker

### 2. Webhook idempotency replay (criterion 2)
expected: Posting the same Pluggy webhook event 3 times produces identical DB state (no duplicate `webhook_events` rows, no double sync). Posting an invalid `X-Pluggy-Signature` header returns 401.
why_human: Requires live Postgres + pg-boss test mode; covered by `tests/integration/pluggy/webhook.test.ts` (7 scenarios). Run via `npm run test:integration -- pluggy/webhook` (Docker / testcontainers required).
result: issue
reported: "Ran full integration suite. 22 test files failed. Root: tests/integration/security/idor.test.ts beforeAll hit 'Hook timed out in 180000ms' — testcontainers Postgres never started. All downstream suites then crashed in afterAll with 'Cannot read properties of undefined (reading stop/end)' because td/pg shared setup variables were never assigned. Final: 22 failed, 1 passed, 2 passed, 83 skipped (86 total). pluggy/webhook.test.ts among the failed (afterAll undefined.end). Additional independent failure: tests/integration/observability/env-assert.test.ts > OPS-04 boot assertion (subprocess) > 'exits 0 for a valid production env (good path)' — got exit 1 instead of 0; the boot subprocess rejects a valid env, mirroring the env-loading symptom in Test 1. Duration 232.93s, setup 110.62s."
severity: blocker

### 3. LOGIN_ERROR reconnect banner (criterion 3)
expected: An item forced into `LOGIN_ERROR` displays the persistent ReAuthBanner; clicking "Reconnect" opens Pluggy Connect for that specific item; no sync is enqueued for the broken item.
why_human: Visual browser render + Pluggy sandbox forcing a login error.
how: Seed a `pluggy_items` row with `status='LOGIN_ERROR'` (or trigger via Pluggy sandbox), refresh the app, click banner CTA.
result: blocked
blocked_by: prior-phase
reason: "Cannot exercise. /connect (and any page importing the env-validating module chain) crashes with the Test 1 ZodError. Banner reconnect CTA opens Pluggy Connect on /connect, which is unreachable until Test 1 env-loading blocker is resolved."

### 4. Transfer detection end-to-end (criterion 4)
expected: A cross-account transfer (debit on checking, credit on savings, opposite-sign equal amount within ±3 days) is flagged `is_transfer=true` on both rows; monthly aggregates exclude the pair.
why_human: Requires Postgres + worker; covered by `tests/integration/services/TransferDetector.test.ts` (6 scenarios). Run via `npm run test:integration -- TransferDetector`.
result: blocked
blocked_by: prior-phase
reason: "Shares the testcontainers + td/pg setup that failed in Test 2. TransferDetector.test.ts was among the 22 cascaded afterAll failures. Cannot run until the testcontainers Postgres boot and shared setup blocker (Test 2) is resolved."

### 5. Fatura detection end-to-end (criterion 5)
expected: A credit-card fatura payment (checking debit matching card balance within ±7 days) is flagged `is_credit_card_payment=true` and excluded from expense aggregates; individual card-line-item transactions remain as expenses.
why_human: Requires Postgres + worker; covered by `tests/integration/services/FaturaDetector.test.ts` (4 scenarios). Run via `npm run test:integration -- FaturaDetector`.
result: blocked
blocked_by: prior-phase
reason: "Shares the testcontainers + td/pg setup that failed in Test 2. FaturaDetector.test.ts was among the 22 cascaded afterAll failures. Cannot run until the testcontainers Postgres boot and shared setup blocker (Test 2) is resolved."

### 6. pluggy_item_id ciphertext confirmation (criterion 6)
expected: A direct `SELECT pluggy_item_id_enc FROM pluggy_items LIMIT 1;` returns ciphertext (length differs from plaintext, first byte varies across writes); no log line, error message, or API response contains a plaintext Pluggy item ID.
why_human: Requires running migrations + at least one connected item; covered by `tests/integration/pluggy/encryption.test.ts`. Run `psql -c "SELECT length(pluggy_item_id_enc), encode(pluggy_item_id_enc, 'hex') FROM pluggy_items LIMIT 3;"` and grep app logs.
result: blocked
blocked_by: prior-phase
reason: "Shares the testcontainers + td/pg setup that failed in Test 2. pluggy/encryption.test.ts was among the 22 cascaded afterAll failures. Manual psql path also requires a connected item, which depends on /connect working (Test 1 blocker)."

### 7. Manual sync cooldown + free-tier paywall (criterion 7)
expected: Requesting manual sync inside the 30-minute cooldown returns a clear "please wait N minutes" message. Free-tier users (no active subscription) cannot trigger manual sync at all (paywall response).
why_human: Requires running app + seeded subscription state; covered by `tests/integration/pluggy/cooldown.test.ts` + `tests/integration/pluggy/free-tier.test.ts`. Run `npm run test:integration -- pluggy/cooldown` and `npm run test:integration -- pluggy/free-tier`, plus a manual UI click.
result: blocked
blocked_by: prior-phase
reason: "Integration portion: pluggy/cooldown.test.ts and pluggy/free-tier.test.ts were both among the 22 cascaded afterAll failures (Test 2 blocker). Manual UI portion: requires running app, which crashes on /connect with the env ZodError (Test 1 blocker)."

## Summary

total: 7
passed: 0
issues: 2
pending: 0
skipped: 0
blocked: 5

## Gaps

- truth: "Opening /connect renders the Pluggy Connect entry point without runtime errors; environment variables required by the web runtime (NODE_ENV, DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY, CPF_HASH_PEPPER) are loaded before module evaluation; server-only env schema is not evaluated in client bundles."
  status: failed
  reason: "User reported: Runtime ZodError on /connect — env validation fails at module evaluation: NODE_ENV invalid, DATABASE_URL undefined, NEXTAUTH_SECRET undefined, ENCRYPTION_KEY undefined, CPF_HASH_PEPPER undefined. Crash thrown from ConnectIsland import chain (src/app/connect/page.tsx:142). Same crash now also surfaces uncaught in the browser ([browser] Uncaught ZodError, same paths) — indicates server-only env validation is being evaluated in a client chunk via the ConnectIsland import graph. Next.js 16.2.4 Turbopack dev server, Node v24."
  severity: blocker
  test: 1
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Webhook idempotency: posting the same Pluggy event 3× yields a single webhook_events row, no double sync; invalid X-Pluggy-Signature returns 401. Verified by tests/integration/pluggy/webhook.test.ts under live Postgres."
  status: failed
  reason: "Integration suite cannot run. Ran `npm run test:integration -- pluggy/webhook` (and full suite). 22 test files failed. Upstream cause: testcontainers Postgres timeout — `tests/integration/security/idor.test.ts` beforeAll hit 'Hook timed out in 180000ms', so the shared `td`/`pg` were never assigned. Every other integration suite (including pluggy/webhook.test.ts, FaturaDetector, TransferDetector, encryption, free-tier, cooldown, reconcile, sync-worker, reauth-flow, reauth-notifier, disconnect, connect-init, connect-token, db/migrations, db/users-schema, lgpd/consent, lgpd/dsr, security/idor, webhooks/ses-bounce, auth/rate-limit) cascaded into afterAll TypeError: 'Cannot read properties of undefined (reading stop/end)'. Independent additional failure: tests/integration/observability/env-assert.test.ts > 'OPS-04 boot assertion (subprocess) > exits 0 for a valid production env (good path)' got exit status 1 (expected 0) — boot subprocess rejects a valid env. Final tally: 22 file failures, 1 assertion failure, 2 tests passed, 83 skipped. Affects criteria 2, 4, 5, 6 and the integration portion of 7. Likely shares root cause with Test 1 env-loading crash."
  severity: blocker
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
