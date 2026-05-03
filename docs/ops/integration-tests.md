# Integration Test Runbook

The integration project (`vitest --project integration`) boots ONE shared
Postgres 16 testcontainer for the entire run and executes all 22 suites
sequentially in one forked worker.

## TL;DR

```bash
docker ps --filter "ancestor=postgres:16-alpine" -q | xargs -r docker rm -f
npm run test:integration
```

PowerShell equivalent for the cleanup:

```powershell
docker ps --filter "ancestor=postgres:16-alpine" -q | ForEach-Object { docker rm -f $_ }
```

## Why it is configured this way

Vitest 3.0.5's default file-parallelism (~`os.cpus().length` forked workers,
each running one test file concurrently) caused a 22-file `afterAll`
TypeError cascade on Windows + Docker Desktop / WSL2: per-container
Postgres init ballooned from ~48 s (uncontended) to >120 s under parallel
Docker pressure. The slowest suite (`security/idor.test.ts`) blew past its
180 s `hookTimeout`, leaving `td`/`pg` undefined; `afterAll` then crashed
with `Cannot read properties of undefined (reading 'stop')` /
`(reading 'end')`.

Plan 02-09 (gap closure) pinned the integration project to:

- `pool: 'forks'` with `singleFork: true` — one forked worker, runs suites
  sequentially. A single forked worker can only run one file at a time, so
  files run sequentially within this project.
- `isolate: false` — keeps the module cache (and `globalThis`) alive
  across test files inside the worker, so the singleton in
  `tests/fixtures/db.ts` is shared across every suite. Without this, vitest
  re-imports the module graph between files even in a single fork.
- `globalSetup: ['tests/fixtures/integration-globals.ts']` — boots one
  testcontainer before any suite runs, stops it after every suite finishes.

`tests/fixtures/db.ts > startTestDb()` is now a `globalThis`-cached
singleton: the first call boots the container; every subsequent call
(across all 22 suites) returns the same `TestDb`. Suite-level
`afterAll(() => td.stop())` is intentionally a no-op — the globalSetup
teardown owns the lifecycle. The cache lives on `globalThis` (not at
module scope) so it survives `vi.resetModules()`, which several Pluggy
suites call in `beforeEach` to re-apply `vi.doMock(...)`.

## Vitest 3.0.5 quirks worth knowing

- `fileParallelism: false` is in `NonProjectOptions` (see
  `node_modules/vitest/dist/chunks/reporters.6vxQttCV.d.ts:2229`) — it is
  REJECTED at the workspace[]-entry level with TS2769 and CANNOT be set
  per-project. We rely on `pool: 'forks'` + `singleFork: true` instead;
  the single-fork pin already serializes file execution within the
  project.
- The `globalSetup` file's `default` export, if present, MUST be a
  function (the single-function form where `setup()` returns a
  `teardown()`). A default-exported `{ setup, teardown }` object is
  rejected with `invalid export in globalSetup file: default must be a
  function`. We use named `setup` + `teardown` exports only — the
  documented and supported shape.

## Prerequisites

- Docker Desktop running with the WSL2 backend (Windows) or any healthy
  Docker daemon (macOS / Linux).
- The `postgres:16-alpine` image cached locally (first run pulls
  ~395 MB):

  ```bash
  docker pull postgres:16-alpine
  ```

- No other process competing for port 5432 — testcontainers picks an
  ephemeral host port, but a stuck Postgres container from a prior run
  can still starve the daemon.

## Cleaning up leaked containers

Testcontainers' Ryuk reaper cleans up after a clean shutdown, but a hard
SIGKILL (or a Docker daemon restart) can leak containers. Symptoms:
unexplained `cannot start service` errors; the run hangs at `setup`.

Cleanup one-liner (bash):

```bash
docker ps --filter "ancestor=postgres:16-alpine" -q | xargs -r docker rm -f
```

PowerShell equivalent:

```powershell
docker ps --filter "ancestor=postgres:16-alpine" -q | ForEach-Object { docker rm -f $_ }
```

After a clean run with `npm run test:integration`, the leaked-container
count is expected to be 0 (the singleton stops cleanly in
`teardown()`). If you see N containers left over, either the run was
killed mid-flight (Ctrl+C is OK — Ryuk catches it) or the singleton was
defeated by a regression to `vitest.config.ts` (e.g.
`isolate: false` was removed). Check the contract.

## Expected wall time

| Environment             | Expected | Hard ceiling |
|-------------------------|----------|--------------|
| CI (Linux + Docker)     | ~1-2 min | 5 min        |
| macOS + Docker Desktop  | ~2-3 min | 7 min        |
| Windows + Docker / WSL2 | ~20-60 s | 8 min        |

Plan 02-09 dry runs on Windows + Docker Desktop / WSL2 with a warm image
cache complete in ~20 seconds. The 8 minute hard ceiling exists for cold
starts (image pull + first-time Docker daemon warmup). If a run exceeds
the hard ceiling, treat it as an infrastructure regression (not a flaky
test) — investigate Docker daemon health first.

## Persistence of process.env across suites

With `singleFork: true` and `isolate: false`, all suites share one Node
process AND one module graph. Each suite's `beforeAll` mutates
`process.env.*` (e.g., `pluggy/webhook.test.ts` sets
`PLUGGY_WEBHOOK_SECRET`; `security/idor.test.ts` sets `ENCRYPTION_KEY`).
Those mutations PERSIST across suites in run order. Existing tests are
written assuming each suite's own `beforeAll` overwrites whatever the
previous one set — do NOT add a global `process.env` reset between
suites.

## Persistence of database state across suites

The 22 suites share ONE Postgres testcontainer. Migrations are applied
once (per-suite `beforeAll` calls are idempotent). However, suite-level
test data (rows inserted in `beforeEach` / test bodies) is NOT
automatically truncated between suites. Suites that depend on a clean
table state must call `TRUNCATE ... CASCADE` themselves in
`beforeEach`. This is a known follow-up: not every suite truncates
today, and some assertion failures observed in plan 02-09's
verification run are caused by cross-suite row bleed (e.g.,
`db/users-schema.test.ts` failing because `lgpd/consent.test.ts` left
rows behind). That cleanup is tracked separately and is not in the
scope of plan 02-09.

## Adding a new integration suite

1. Place under `tests/integration/<area>/<feature>.test.ts`.
2. Call `await startTestDb()` in `beforeAll` — the singleton returns the
   shared container; do NOT add `withReuse()` or any container-lifecycle
   hooks of your own.
3. Apply migrations once per suite (`drizzle-orm/postgres-js/migrator`)
   — migrations are idempotent against the shared schema, so this is a
   ~50 ms no-op after the first suite has run.
4. Truncate any tables your suite mutates in `beforeEach` to defend
   against cross-suite row bleed (see above).
5. Set the `process.env.*` your suite needs in `beforeAll` (overrides
   whatever the previous suite left).
6. Keep `afterAll(() => td.stop())` if your suite already has one — it
   is a no-op now but harmless. New suites can omit it entirely.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Hook timed out in 180000ms` in globalSetup | Docker daemon unreachable or starved | Check `docker info`; clean up leaked containers |
| All 22 suites pass except env-assert | env-assert good-path fixture drift | See plan 02-08 |
| `Cannot read properties of undefined (reading 'stop')` returns | `singleFork: true` was reverted, `isolate: false` was removed, or globalSetup file moved | Verify `vitest.config.ts`; this plan's contract is binding |
| 13+ leaked containers per run | The singleton is being defeated by `vi.resetModules()` — check that `tests/fixtures/db.ts` still uses `globalThis` (not module-scope `let _started`) | Restore the `globalThis` cache in `db.ts` |
| `invalid export in globalSetup file: default must be a function` | A `default export` was added to `tests/fixtures/integration-globals.ts` that isn't a single function | Use named `setup` + `teardown` exports only |
| Run takes >10 min | Docker Desktop memory pressure (Windows) | Restart Docker Desktop; bump WSL2 memory in `.wslconfig` |
