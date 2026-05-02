---
status: diagnosed
trigger: "22 integration test files fail with `Cannot read properties of undefined (reading 'stop')` / `(reading 'end')` in afterAll. idor.test.ts beforeAll Hook timed out 180000ms. env-assert good-path returns exit 1."
created: 2026-05-02T00:00:00Z
updated: 2026-05-02T00:00:00Z
---

## Current Focus

hypothesis: Two independent root causes
  (1) Integration suites all spawn their own `PostgreSqlContainer` in parallel via Vitest's default file-level parallelism — Docker overload on Windows/WSL2 makes startup exceed the 180s `hookTimeout`, leaving `td`/`pg` undefined; afterAll then throws on `td.stop()` / `pg.end()`.
  (2) `env-assert.test.ts` "good production env" fixture is stale — missing the Phase 02 Pluggy production fields (`PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_WEBHOOK_SECRET`, `PLUGGY_ENV=production`, `PLUGGY_ITEM_ID_HASH_PEPPER`) that `src/lib/env.ts` now requires for `SERVICE_NAME=web|worker` in production.
test: confirmed both via direct reproduction.
expecting: see Evidence.
next_action: return diagnosis to orchestrator.

## Symptoms

expected: |
  All Phase 02 integration suites pass under testcontainers + pg.
  - `webhook.test.ts` 7 scenarios pass (idempotency replay).
  - All services / pluggy / db / lgpd / security / webhooks / auth suites green.
  - `env-assert.test.ts > "exits 0 for a valid production env (good path)"` exits 0.
actual: |
  - 22 test files failed; 1 assertion failed; 2 tests passed; 83 skipped (86 total).
  - Duration 232.93s; setup 110.62s; tests 3606.36s wall (parallel cumulative).
  - First failure: `tests/integration/security/idor.test.ts` — `Hook timed out in 180000ms`.
  - Cascade pattern A (7 suites): `TypeError: Cannot read properties of undefined (reading 'stop')` in afterAll where body is `await td.stop()`.
  - Cascade pattern B (13 suites): `TypeError: Cannot read properties of undefined (reading 'end')` in afterAll where body is `await pg.end(); await td.stop()`.
  - Independent: `env-assert.test.ts > exits 0 for a valid production env (good path)` — `expected 1 to be +0`. Subprocess returns exit 1 for valid env fixture.
errors: |
  - Hook timed out in 180000ms (idor)
  - TypeError: Cannot read properties of undefined (reading 'stop')
  - TypeError: Cannot read properties of undefined (reading 'end')
  - expected 1 to be +0 (env-assert good path)
reproduction: "npm run test:integration from repo root"
started: "Cascade was always at risk by design (per-suite testcontainers, no globalSetup); env-assert good-path break appeared when Phase 02 added PLUGGY_* fields to env.ts (commit e10df14 feature(pluggy-webhook)... and earlier d5c5913 feature(pluggy-service)...)."

## Eliminated

- hypothesis: "Node v24 broke testcontainers compatibility (commit b22134f)"
  evidence: |
    `node_modules/testcontainers/package.json` (v10.16.0) declares NO `engines` field.
    Direct manual test (`new PostgreSqlContainer('postgres:16-alpine').start()`) on Node v24.13.0 + Docker 29.1.3 succeeds when run alone — the API layer works fine.
    The bump to Node 24 didn't change testcontainers behavior; the test infra was already structurally fragile (per-suite containers).
  timestamp: 2026-05-02

- hypothesis: "Postgres image not cached / first-run image pull dominated setup"
  evidence: |
    `docker images postgres:16-alpine` → image is present (395MB). Image pull is not the bottleneck.
  timestamp: 2026-05-02

- hypothesis: "Docker daemon not running"
  evidence: |
    `docker info --format "{{.ServerVersion}}"` → 29.1.3, daemon healthy.
  timestamp: 2026-05-02

- hypothesis: "env-assert is a cascade victim of the testcontainers timeout"
  evidence: |
    env-assert.test.ts does NOT use testcontainers — it spawns `tsx env-runner.ts` as a subprocess and just imports `@/lib/env`. It is independent of the testcontainers cascade.
    Reproduced standalone: feeding the literal `goodProductionEnv()` to `env-runner.ts` returns exit 1 with stderr:
      `OPS-04 violation: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV=production, and PLUGGY_ITEM_ID_HASH_PEPPER are required in production for web/worker`
  timestamp: 2026-05-02

## Evidence

- timestamp: 2026-05-02
  checked: tests/integration/**/*.test.ts (21 of 22 grep'd for startTestDb)
  found: |
    Every integration suite calls `startTestDb()` in its OWN beforeAll. There is NO globalSetup, NO singleton container, NO container reuse.
  implication: |
    With Vitest 3.0.5 default `fileParallelism: true`, running `vitest run --project integration` spawns N worker processes (default `os.cpus().length`), and each calls `new PostgreSqlContainer('postgres:16-alpine').start()` simultaneously. On Docker Desktop / WSL2, parallel container init thrashes the daemon.

- timestamp: 2026-05-02
  checked: vitest.config.ts
  found: |
    Integration project sets `testTimeout: 60_000`, `hookTimeout: 120_000` — but no `pool`, `poolOptions`, `maxWorkers`, `fileParallelism`, `globalSetup`, or `singleFork`.
  implication: |
    Default file parallelism applies. 22 files race for Docker. Some suites override `beforeAll(..., 180_000)` (idor, webhook), most use the 120s default. First container that completes `start()` sometimes succeeds; the rest cascade-time-out.

- timestamp: 2026-05-02
  checked: tests/fixtures/db.ts
  found: |
    `startTestDb` instantiates a fresh `PostgreSqlContainer('postgres:16-alpine')` per call. No reuse, no `withReuse()`, no shared singleton.
  implication: |
    By design, every test file gets its own container. This is fine when files run sequentially; catastrophic in parallel.

- timestamp: 2026-05-02
  checked: docker logs of leaked postgres containers (e.g. 9daf8c97a387)
  found: |
    "PostgreSQL init process complete; ready for start up." then "starting PostgreSQL 16.13" then 38s SHUTDOWN CHECKPOINT (`sync=36.164 s`) then second "ready to accept connections" — total ~48s wall just for one container's two-stage init under contention. testcontainers' `LogWaitStrategy` waits for the SECOND occurrence of the "ready" message (Postgres init scripts cause a restart). Multiple parallel containers = each one's I/O is starved → 48s ballooned to >120s for any single suite.
    Many leaked postgres containers from prior failed runs (4 still up, status "Up 46 minutes / Up 47 minutes"), confirming testcontainers' `Ryuk` reaper did not clean up after the timeouts.
  implication: |
    Per-suite parallel container startup is the dominant root cause of the 22-file cascade. The 180s timeout on idor's beforeAll exhausted while waiting on Docker, leaving `td` undefined; afterAll then crashed on `td.stop()`. Same logic explains the 13 `pg.end()` failures — `pg = postgres(td.url, { max: 1 })` runs AFTER `td = await startTestDb()`, so when startTestDb hangs, both `pg` and `td` remain undefined.

- timestamp: 2026-05-02
  checked: tests/fixtures/env-runner/env-runner.ts + src/lib/env.ts + tests/integration/observability/env-assert.test.ts goodProductionEnv()
  found: |
    `env.ts` has THREE `.refine()` blocks gating production:
    (a) OPS-04 sandbox-in-prod (DSN/SENTRY_ENV/NEXTAUTH_URL/PLUGGY_ENV/ASAAS_ENV)
    (b) Turnstile keys required in production (web only)
    (c) Phase 02: `PLUGGY_CLIENT_ID && PLUGGY_CLIENT_SECRET && PLUGGY_WEBHOOK_SECRET && PLUGGY_ENV === 'production' && PLUGGY_ITEM_ID_HASH_PEPPER` — required when `NODE_ENV=production` and `SERVICE_NAME` is web/worker.

    `goodProductionEnv()` provides only Sentry + Turnstile + AWS + base secrets. It does NOT set `PLUGGY_*` or `SERVICE_NAME` (so SERVICE_NAME defaults to `'web'`).

    Direct reproduction:
      Spawned env-runner.ts with literal `goodProductionEnv()` payload + `NEXT_PHASE=undefined`.
      Result: exit code 1, stderr: `OPS-04 violation: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV=production, and PLUGGY_ITEM_ID_HASH_PEPPER are required in production for web/worker`.
  implication: |
    The "good path" fixture in env-assert.test.ts was authored before Phase 02's third refine was added. It is a stale test fixture; not a runtime bug. The test correctly catches the misalignment ("If this fails it means our 'good' env is actually bad — fix the fixture.").

- timestamp: 2026-05-02
  checked: tests/integration/{security/idor.test.ts, db/migrations.test.ts, ...}
  found: |
    Suites that crash on `td.stop()` only have `let td`. Suites that crash on `pg.end()` have `let td; let pg;` and assign `pg = postgres(td.url, ...)` after `td = await startTestDb()`. When `startTestDb()` rejects/hangs, neither variable is assigned, so afterAll throws on the first undefined access encountered.
  implication: |
    Two visible failure shapes are the SAME upstream cause (parallel container startup contention).

## Resolution

root_cause: |
  Two independent issues surfaced by `npm run test:integration`:

  ROOT CAUSE 1 (cascade — 22 file failures):
    Every integration test file in `tests/integration/**/*.test.ts` calls `startTestDb()` in its own `beforeAll`, spinning up a fresh `PostgreSqlContainer('postgres:16-alpine')` per file. `vitest.config.ts` integration project does NOT set `pool: 'forks'` with `singleFork: true`, does NOT set `maxWorkers: 1`, does NOT set `fileParallelism: false`, and does NOT register a `globalSetup` to share ONE container across files. With Vitest 3.0.5 defaults, all 22 files run in parallel worker processes; ~8 simultaneous Postgres containers thrash Docker Desktop / WSL2 on Windows. The slowest container (idor) exceeds its 180s `hookTimeout`. `td = await startTestDb()` rejects → `td` is undefined → afterAll throws `Cannot read properties of undefined (reading 'stop')`. Suites that also have `let pg` throw on `pg.end()` for the same reason (`pg` is assigned AFTER the failing `await startTestDb()`).

    Files involved:
      - tests/fixtures/db.ts — per-call container, no reuse
      - vitest.config.ts:23-30 — integration project missing `globalSetup`/`pool`/`fileParallelism: false`
      - tests/integration/**/*.test.ts (all 21 suites) — each owns its own container

  ROOT CAUSE 2 (env-assert good-path, 1 assertion):
    `tests/integration/observability/env-assert.test.ts:23-39` `goodProductionEnv()` fixture is stale relative to the Phase 02 env schema. `src/lib/env.ts:175-192` adds a third `.refine()` block requiring `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_WEBHOOK_SECRET`, `PLUGGY_ENV='production'`, and `PLUGGY_ITEM_ID_HASH_PEPPER` whenever `NODE_ENV=production` and `SERVICE_NAME` ∈ {web, worker} (default is `web`). The fixture omits all of these, so the parse throws and `env-runner.ts` exits 1.

    Files involved:
      - tests/integration/observability/env-assert.test.ts:23-39 — `goodProductionEnv()` missing Pluggy fields
      - src/lib/env.ts:175-192 — third refine block enforces Phase 02 requirements

fix: |
  (Out of scope for this agent — handled by /gsd-plan-phase --gaps.)

verification: |
  (Pending fix.)

files_changed: []
