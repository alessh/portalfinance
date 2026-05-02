---
status: diagnosed
phase: 02-pluggy-ingestion
source: [02-VERIFICATION.md]
started: 2026-05-02T13:00:00Z
updated: 2026-05-02T16:05:00Z
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
  root_cause: |
    Compound issue. (a) src/lib/env.ts has no `import 'server-only'` guard and runs `EnvSchema.parse(process.env)` at module load (line ~194). The client island chain ConnectIsland ('use client') -> ConsentScreen ('use client', src/components/consent/ConsentScreen.tsx:28) -> CPFSchema (src/lib/cpf.ts:21) -> encryptCPF/hashCPF (src/lib/crypto.ts:24) -> env (src/lib/env.ts) drags the server-only env validator into the client bundle. In the browser process.env is empty (Next.js only inlines NEXT_PUBLIC_*), so every required field fails Zod validation; NODE_ENV reports `invalid_value` (Zod v4 enum semantics on undefined/empty string), DATABASE_URL/NEXTAUTH_SECRET/ENCRYPTION_KEY/CPF_HASH_PEPPER report `invalid_type: undefined`. (b) Independently, no `.env.local` / `.env.development.local` / `.env.development` / `.env` exists at repo root (only `.env.example`), so even SSR has none of the required vars and would fail server-side too. The root cause of the cpf.ts client/server entanglement is that `cpf.ts` co-locates the pure-client CPFSchema/formatCPF with the server-only encryptAndHashCPF — any client import of CPFSchema drags the server graph.
  artifacts:
    - path: "src/lib/env.ts"
      issue: "Missing `import 'server-only'`; eagerly executes EnvSchema.parse(process.env) at module load."
    - path: "src/lib/crypto.ts"
      issue: "Missing `import 'server-only'`; imports node:crypto and env at top; reachable from client via cpf.ts."
    - path: "src/lib/cpf.ts"
      issue: "Co-locates pure-client CPFSchema + formatCPF with server-only encryptAndHashCPF; client imports of CPFSchema drag the server graph."
    - path: "src/components/consent/ConsentScreen.tsx"
      issue: "'use client' boundary that imports CPFSchema from @/lib/cpf — first client consumer to reach env.ts (Phase 02 addition)."
    - path: "src/app/connect/ConnectIsland.tsx"
      issue: "'use client' parent that mounts ConsentScreen; explains why the crash points at connect/page.tsx:142 (JSX site of ConnectIsland)."
    - path: "<repo root>"
      issue: "Missing local dev env file (.env.local / .env.development.local); only .env.example exists."
    - path: "tests/integration/observability/env-assert.test.ts:23-39"
      issue: "goodProductionEnv() fixture predates Phase 02 schema extension at src/lib/env.ts:175-192 — missing PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV='production', PLUGGY_ITEM_ID_HASH_PEPPER. Cross-confirmed by the sibling debug agent investigating Test 2."
  missing:
    - "Add `import 'server-only'` at the top of src/lib/env.ts."
    - "Add `import 'server-only'` at the top of src/lib/crypto.ts."
    - "Split src/lib/cpf.ts into a pure-client module (CPFSchema, formatCPF — no server imports) and a server-only module (e.g., src/lib/cpfServer.ts) for encryptAndHashCPF; update import sites accordingly."
    - "Update ConsentScreen and any other client consumers to import only from the pure-client cpf module."
    - "Create a developer-friendly local env file template (e.g., .env.development.local or update .env.example with a copy step) populating NODE_ENV, DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY, CPF_HASH_PEPPER, plus the Phase 02 PLUGGY_* fields."
    - "Update goodProductionEnv() in tests/integration/observability/env-assert.test.ts to include the Phase 02-required PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET (≥32), PLUGGY_WEBHOOK_SECRET (≥32), PLUGGY_ENV='production', PLUGGY_ITEM_ID_HASH_PEPPER (≥32)."
    - "Add a regression guard (lint rule, codemod, or test) to prevent any 'use client' module from transitively importing @/lib/env."
  debug_session: ".planning/debug/connect-env-zoderror.md"

- truth: "Webhook idempotency: posting the same Pluggy event 3× yields a single webhook_events row, no double sync; invalid X-Pluggy-Signature returns 401. Verified by tests/integration/pluggy/webhook.test.ts under live Postgres."
  status: failed
  reason: "Integration suite cannot run. Ran `npm run test:integration -- pluggy/webhook` (and full suite). 22 test files failed. Upstream cause: testcontainers Postgres timeout — `tests/integration/security/idor.test.ts` beforeAll hit 'Hook timed out in 180000ms', so the shared `td`/`pg` were never assigned. Every other integration suite (including pluggy/webhook.test.ts, FaturaDetector, TransferDetector, encryption, free-tier, cooldown, reconcile, sync-worker, reauth-flow, reauth-notifier, disconnect, connect-init, connect-token, db/migrations, db/users-schema, lgpd/consent, lgpd/dsr, security/idor, webhooks/ses-bounce, auth/rate-limit) cascaded into afterAll TypeError: 'Cannot read properties of undefined (reading stop/end)'. Independent additional failure: tests/integration/observability/env-assert.test.ts > 'OPS-04 boot assertion (subprocess) > exits 0 for a valid production env (good path)' got exit status 1 (expected 0) — boot subprocess rejects a valid env. Final tally: 22 file failures, 1 assertion failure, 2 tests passed, 83 skipped. Affects criteria 2, 4, 5, 6 and the integration portion of 7. Likely shares root cause with Test 1 env-loading crash."
  severity: blocker
  test: 2
  root_cause: |
    Two independent failures surfaced by the same `npm run test:integration` run.
    (1) Cascade: every integration suite owns its own Postgres testcontainer (tests/fixtures/db.ts:23-47 returns a fresh container per call, no withReuse(), no module-level singleton). vitest.config.ts:23-30 integration project sets neither globalSetup, nor pool: 'forks' / singleFork: true, nor fileParallelism: false — Vitest 3.0.5 default is full file parallelism. With 21 suites racing to start fresh `postgres:16-alpine` containers on Windows + Docker Desktop/WSL2, Docker I/O is starved; LogWaitStrategy waits for `database system is ready to accept connections` but per-container startup includes a ~38s shutdown-checkpoint between two startup phases (~48s under no contention). The slowest-to-start suite (idor) blew past its 180s hookTimeout, leaving td (and pg, which is assigned afterwards) undefined; afterAll then throws TypeError on undefined.stop()/.end(). Reproduced standalone: a single PostgreSqlContainer.start() with leaked sibling containers from prior runs hits the 120s LogWaitStrategy timeout. Node v24 bump (commit b22134f) is NOT the cause — eliminated, the test infra was structurally fragile from the start.
    (2) env-assert good-path: tests/integration/observability/env-assert.test.ts:23-39 goodProductionEnv() is stale. Phase 02 added a third .refine() block at src/lib/env.ts:175-192 that requires PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV='production', and PLUGGY_ITEM_ID_HASH_PEPPER whenever NODE_ENV=production and SERVICE_NAME ∈ {web, worker} (SERVICE_NAME defaults to 'web'). The fixture provides none of these. Reproduced standalone by spawning env-runner.ts with the literal goodProductionEnv() payload — exits 1 with `OPS-04 violation: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV=production, and PLUGGY_ITEM_ID_HASH_PEPPER are required in production for web/worker`. Cross-confirmed by sibling debug agent investigating Test 1.
  artifacts:
    - path: "vitest.config.ts:23-30"
      issue: "Integration project lacks `globalSetup`, `pool: 'forks' + singleFork: true`, `fileParallelism: false`, and `maxWorkers: 1`. Allows all 21 suites to race for Docker simultaneously."
    - path: "tests/fixtures/db.ts:23-47"
      issue: "startTestDb() always builds a brand-new PostgreSqlContainer('postgres:16-alpine'); no module-level singleton, no withReuse()."
    - path: "tests/integration/**/*.test.ts (21 files)"
      issue: "Each suite calls startTestDb() in its own beforeAll, owning its own per-suite container."
    - path: "tests/integration/observability/env-assert.test.ts:23-39"
      issue: "goodProductionEnv() fixture missing PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV='production', PLUGGY_ITEM_ID_HASH_PEPPER required by the Phase 02 prod refinement."
    - path: "src/lib/env.ts:175-192"
      issue: "Third .refine() block requires Phase 02 Pluggy production fields for SERVICE_NAME=web|worker (this code is correct — the fixture is the bug)."
    - path: "tests/fixtures/env-runner/env-runner.ts"
      issue: "Subprocess that imports @/lib/env; correctly surfaces the validation failure as exit 1 + stderr (this code is correct — the fixture is the bug)."
  missing:
    - "Introduce a single shared testcontainer for the integration project: a vitest globalSetup that calls startTestDb() once, exposes DATABASE_URL via env, and stops the container in teardown."
    - "OR (simpler short-term) pin the integration project to `pool: 'forks', poolOptions: { forks: { singleFork: true } }` so suites run sequentially in one worker; combine with a module-level singleton in tests/fixtures/db.ts."
    - "Refactor tests/fixtures/db.ts to expose a singleton/lazy-cached testcontainer rather than building one per call."
    - "Update goodProductionEnv() in tests/integration/observability/env-assert.test.ts to populate PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET (≥32 chars), PLUGGY_WEBHOOK_SECRET (≥32 chars), PLUGGY_ENV='production', PLUGGY_ITEM_ID_HASH_PEPPER (≥32 chars)."
    - "Document Docker prerequisites for integration tests (image pre-pull, leaked-container cleanup) in the testing README or a make-target."
  debug_session: ".planning/debug/integration-tests-testcontainers-cascade.md"
