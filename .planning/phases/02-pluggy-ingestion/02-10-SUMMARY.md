---
phase: 02-pluggy-ingestion
plan: 10
subsystem: security
tags: [server-only, worker, tsx, lgpd, ops-04, conn-01, sec-01, cjs-resolution, defense-in-depth]

# Dependency graph
requires:
  - phase: 02-pluggy-ingestion
    provides: cpf.ts/cpfServer.ts split (02-07); .env.local canonical local-dev contract (02-08); singleton testcontainer + globalSetup (02-09)
provides:
  - assertServerOnly() helper at src/lib/serverOnly.ts
  - tsx-direct entrypoints (worker, db:migrate, e2e) load env.ts + crypto.ts without crashing
  - cpf-client-isolation walker extended to include @/lib/serverOnly in FORBIDDEN_FROM_CLIENT
  - server-only-tsx-subprocess regression test that would have caught plan 02-07's overshoot
  - single --env-file-if-exists=.env.local flag in tsx scripts (no duplicate ".env not found" log)
affects: [03-categorization, 04-dashboard, 05-billing, every-future-server-only-module]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "assertServerOnly() runtime guard — typeof window + window.document strict check"
    - "vi.mock('@/lib/serverOnly') in tests/setup.ts to neutralize the runtime check under happy-dom"
    - "vi.unmock('@/lib/serverOnly') per file when the test must exercise the real helper"
    - "fixture scripts include `export {};` so isolatedModules treats each file as its own module"

key-files:
  created:
    - src/lib/serverOnly.ts
    - tests/unit/lib/serverOnly.test.ts
    - tests/integration/observability/server-only-tsx-subprocess.test.ts
    - tests/fixtures/server-only/import-server-modules.ts
  modified:
    - src/lib/env.ts (drop literal `import 'server-only'`, call assertServerOnly())
    - src/lib/crypto.ts (drop literal `import 'server-only'`, call assertServerOnly())
    - tests/unit/lib/cpf-client-isolation.test.ts (FORBIDDEN_FROM_CLIENT += @/lib/serverOnly)
    - tests/setup.ts (add vi.mock('@/lib/serverOnly') alongside existing vi.mock('server-only'))
    - tests/fixtures/env-runner/env-runner.ts (drop Module._cache pre-stub; add `export {}`)
    - package.json (drop redundant `--env-file-if-exists=.env` from start:worker, test:e2e, db:migrate)

key-decisions:
  - "Plan 02-10 must_have #3 (`import 'server-only'` at top of serverOnly.ts) was REVERSED via Rule 1 deviation — the leaf import crashed tsx at module load (server-only/index.js throws unconditionally; the react-server export condition only resolves under Next.js webpack alias or with `node --conditions=react-server`)."
  - "Defense-in-depth preserved without leaf import: cpfServer.ts retains its own `import 'server-only'` (cpf chain compile-time guard) + walker FORBIDDEN_FROM_CLIENT extended to include @/lib/serverOnly (any new client→server-only chain fails the unit suite)."
  - "Task 8 setup.ts cleanup ROLLED BACK (rollback path preselected by plan): vi.mock('server-only') retained for cpfServer.ts's transitive import; vi.mock('@/lib/serverOnly') ADDED so 15+ existing env.test.ts/crypto.test.ts assertions pass under happy-dom (which provides window+document and would trip assertServerOnly)."
  - "tests/unit/lib/serverOnly.test.ts uses vi.unmock('@/lib/serverOnly') so the helper coverage is real, not mocked."
  - "Both fixture scripts (env-runner.ts, import-server-modules.ts) include `export {};` to satisfy tsc's isolatedModules + tsconfig include='tests/**/*.ts' (their top-level `main` functions otherwise collide as duplicate global declarations)."

patterns-established:
  - "Server-only runtime guard: assertServerOnly() with strict window+document check — silent under Node/tsx/SSR-shim polyfills, throws under genuine browsers and happy-dom."
  - "Test-time mock layering: package mock (vi.mock('server-only')) covers leaf transitive imports; helper mock (vi.mock('@/lib/serverOnly')) covers runtime assertion under happy-dom; per-file unmock for files that test the helper itself."
  - "Subprocess regression pattern: spawn(node_modules/.bin/tsx[.cmd]) with absolute path, hermetic VALID_ENV object, integration project (singleFork sequential per plan 02-09), shell:true on Windows for .cmd shims."

requirements-completed: [LGPD-02, CONN-01, SEC-01, OPS-04]

# Metrics
duration: ~14min
completed: 2026-05-03
---

# Phase 02 Plan 10: Worker server-only Boot Crash Gap Closure

**assertServerOnly() helper replaces `import 'server-only'` in env.ts/crypto.ts so tsx-direct entrypoints (worker, db:migrate, e2e) boot without crashing — defense-in-depth preserved at cpfServer.ts + cpf-client-isolation walker.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-03T13:00:00Z (approx; first commit 13:02:26Z)
- **Completed:** 2026-05-03T13:14:00Z (last task commit 13:12:20Z)
- **Tasks:** 9 / 9
- **Files modified:** 10 (4 created, 6 modified)

## Accomplishments

- Worker boot probe NO LONGER produces "Cannot be imported from a Client Component module" — bash `timeout 12 pnpm start:worker` exits with `connect ECONNREFUSED 127.0.0.1:5432` (expected pg-boss connection failure when no local Postgres) — 0 matches for `Client Component` in stderr.
- `tsx -e "import('./src/lib/env').then(...)"` exits 0 with `ENV_OK` against a populated `.env.local` (the smoke test from must_have truth #1).
- New regression test `tests/integration/observability/server-only-tsx-subprocess.test.ts` codifies the smoke — would have caught plan 02-07's overshoot before merge.
- `cpf-client-isolation` walker FORBIDDEN_FROM_CLIENT extended to include `@/lib/serverOnly`, preserving 02-VERIFICATION.md row 8 (cpf chain regression guard).
- `package.json` tsx scripts (start:worker, test:e2e, db:migrate) each pass exactly one `--env-file-if-exists=.env.local` — no more duplicate ".env not found" log line.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/lib/serverOnly.ts assertion helper** — `303701b` (feature)
2. **Task 2: Replace `import 'server-only'` in env.ts with assertServerOnly() call** — `517540b` (refactor)
3. **Task 3: Replace `import 'server-only'` in crypto.ts with assertServerOnly() call** — `bb9ef4e` (refactor)
4. **Task 4: Update cpf-client-isolation walker FORBIDDEN_FROM_CLIENT** — `eab12dd` (test)
5. **Task 5: Add unit test for assertServerOnly() polyfill behavior** — `7421e29` (test)
5b. **Rule 1 deviation: drop top-level `import 'server-only'` from serverOnly.ts** — `1039518` (fix; logically pre-Task 6)
6. **Task 6: Add tsx-subprocess regression test** — `b5e93ab` (test)
7. **Task 7: Drop redundant `--env-file-if-exists=.env` from tsx scripts** — `0a7c71c` (fix)
8. **Task 8: Strip Module._cache stub; rollback vi.mock with deeper @/lib/serverOnly mock** — `67f6222` (test)
9. **Task 9: End-to-end smoke** — verification-only, no commit

**Plan metadata:** to be added in the final docs commit (see end of this summary).

## Files Created/Modified

### Created

- `src/lib/serverOnly.ts` — assertServerOnly() helper. After Rule 1 deviation, NO `import 'server-only';` at top — runtime check only. Strict `typeof window !== 'undefined' && typeof window.document !== 'undefined'` guard so SSR-shim polyfills (`globalThis.window = {}`) and future Node `window` globals don't false-positive.
- `tests/unit/lib/serverOnly.test.ts` — 4 assertions: throws on browser-shape, silent without window, silent without window.document, error message contract. Uses `vi.unmock('@/lib/serverOnly')` so it exercises the real helper despite the global mock in tests/setup.ts.
- `tests/integration/observability/server-only-tsx-subprocess.test.ts` — spawns `tsx <fixture>` with hermetic VALID_ENV, asserts exit 0 + stdout contains "OK" + stderr does NOT match `/Client Component/i`.
- `tests/fixtures/server-only/import-server-modules.ts` — fixture for the above; does `await import('../../../src/lib/env')` then `await import('../../../src/lib/crypto')` then prints "OK" and exits 0.

### Modified

- `src/lib/env.ts` — byte-level diff:
  - **Removed (line 25):** `import 'server-only';`
  - **Added (line 25):** `import { assertServerOnly } from '@/lib/serverOnly';`
  - **Added (line 28):** `assertServerOnly();` (between imports and `const EnvSchema = z.object({...})`)
  - **Updated JSDoc:** "Imports: ONLY zod" → "Imports: zod and @/lib/serverOnly only" + new SECURITY paragraph referencing plan 02-10.
  - Schema body, three .refine() blocks, EnvSchema.parse(process.env), and Env type export are byte-for-byte unchanged.
- `src/lib/crypto.ts` — byte-level diff:
  - **Removed (line 18):** `import 'server-only';`
  - **Added (after JSDoc):** `import { assertServerOnly } from '@/lib/serverOnly';`
  - **Added (after `import { env } from '@/lib/env';`):** `assertServerOnly();` (before `const KEY = Buffer.from(env.ENCRYPTION_KEY, 'base64');`)
  - **Updated JSDoc:** appended SECURITY paragraph referencing plan 02-10.
  - encryptCPF / decryptCPF / hashCPF / hashPluggyItemId function bodies are byte-for-byte unchanged.
- `tests/unit/lib/cpf-client-isolation.test.ts` — `FORBIDDEN_FROM_CLIENT.add('@/lib/serverOnly')` + JSDoc update referencing plan 02-10. Walker logic, regex, resolveAlias, walk function unchanged. Both `it()` blocks still GREEN.
- `tests/setup.ts` — Task 8 ROLLBACK PATH applied:
  - **Kept** `vi.mock('server-only', () => ({}))` for cpfServer.ts's direct package import.
  - **Added** `vi.mock('@/lib/serverOnly', () => ({ assertServerOnly: () => {} }))` so env.ts/crypto.ts callsites are no-ops under happy-dom (which provides window+document).
  - Updated comment block documenting the rollback rationale and the future cleanup path.
- `tests/fixtures/env-runner/env-runner.ts` — fully rewritten:
  - **Removed:** Module._cache pre-stub for 'server-only', `import { createRequire }`, `import Module from 'node:module'`, the cache mutation block.
  - **Kept:** the `await import('../../../src/lib/env')` + try/catch + exit 0/1 contract.
  - **Added:** `export {};` so tsc treats this as a module (otherwise its top-level `main` collides with the new fixture's `main` under tsconfig include='tests/**/*.ts').
  - env-assert integration test still 3/3 GREEN.
- `package.json` — three lines changed verbatim:
  - **Before:** `"start:worker": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local src/jobs/worker.ts"`
  - **After:**  `"start:worker": "tsx --env-file-if-exists=.env.local src/jobs/worker.ts"`
  - **Before:** `"test:e2e": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/run-e2e.ts"`
  - **After:**  `"test:e2e": "tsx --env-file-if-exists=.env.local scripts/run-e2e.ts"`
  - **Before:** `"db:migrate": "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local src/db/migrate.ts"`
  - **After:**  `"db:migrate": "tsx --env-file-if-exists=.env.local src/db/migrate.ts"`
  - All other scripts and the dependencies/devDependencies blocks are byte-identical.

## Decisions Made

1. **Rule 1 deviation: drop top-level `import 'server-only';` from `src/lib/serverOnly.ts`.** The plan's must_have #3 mandated keeping it (defense-in-depth at the leaf). However, the package's CJS index.js throws unconditionally — the `react-server` export condition only resolves under Next.js webpack alias or with `node --conditions=react-server`. Reaching `assertServerOnly()` under tsx requires loading `serverOnly.ts`, which crashed before the runtime check could fire. **Compile-time client-bundle guard preserved instead at:** (a) `cpfServer.ts` (still `import 'server-only';` directly — defense at the cpf chain leaf), (b) the cpf-client-isolation walker now flags `@/lib/serverOnly` in FORBIDDEN_FROM_CLIENT (any new client→server-only chain fails the unit suite). **Plan must_have #3 is no longer achievable as written without breaking the plan's primary goal — the trade-off was unavoidable.**

2. **Task 8 ROLLBACK PATH selected (preselected as acceptable by plan).** `vi.mock('server-only')` cleanup probe failed: removing the mock kept env.ts/crypto.ts assertions broken because they now call `assertServerOnly()` at module load and happy-dom provides window+document. Restored the mock AND added a deeper `vi.mock('@/lib/serverOnly')` to neutralize the runtime check under happy-dom. The 15+ existing env.test.ts/crypto.test.ts assertions all GREEN. `tests/unit/lib/serverOnly.test.ts` uses `vi.unmock('@/lib/serverOnly')` so it still exercises the real helper.

3. **Fixture isolation via `export {};`.** Both `tests/fixtures/env-runner/env-runner.ts` and `tests/fixtures/server-only/import-server-modules.ts` define a top-level `async function main()`. Without `export {};`, tsc treats them as global scripts and emits TS2393 "Duplicate function implementation" because both fall under `tsconfig.include='tests/**/*.ts'`. Adding the marker makes each file an isolated module.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Drop top-level `import 'server-only';` from serverOnly.ts**

- **Found during:** Task 6 (running the new tsx-subprocess test for the first time)
- **Issue:** The plan's must_have #3 hypothesized "Plain Node / tsx callers walk through `serverOnly.ts → assertServerOnly()` and the body uses `typeof window` checks." This is incorrect: the literal `import 'server-only';` at the top of serverOnly.ts is the FIRST statement to evaluate when tsx loads the file, and the package's CJS index.js throws unconditionally. The runtime `assertServerOnly()` check is never reached. The new `server-only-tsx-subprocess` integration test failed with the canonical message: `This module cannot be imported from a Client Component module. It should only be used from a Server Component.`
- **Fix:** Removed `import 'server-only';` from `src/lib/serverOnly.ts`. Kept the runtime `assertServerOnly()` check. Defense-in-depth preserved by `cpfServer.ts`'s own `import 'server-only';` (cpf chain) + the cpf-client-isolation walker now flagging `@/lib/serverOnly` (any new client→server-only chain fails the unit suite at compile-time-equivalent test time).
- **Files modified:** `src/lib/serverOnly.ts` (removed import, updated JSDoc to document the rationale).
- **Verification:** Subprocess test now passes (1/1 GREEN, 486ms); cpf-client-isolation walker still flags 7 violations from `cpfServer.ts` (sanity assertion); typecheck clean; full unit suite (77 tests) GREEN.
- **Committed in:** `1039518` (between Task 5 and Task 6 commits)

**2. [Rule 3 - Blocking] Add `vi.mock('@/lib/serverOnly')` to tests/setup.ts (Task 8 rollback)**

- **Found during:** Task 8 (cleanup probe — running full unit suite after removing `vi.mock('server-only', () => ({}))` from tests/setup.ts)
- **Issue:** Plan Task 8 hoped to remove the existing `vi.mock('server-only')` line because, after Tasks 2-3, env.ts and crypto.ts no longer import the package. Plan acknowledged this was conditional ("If any test breaks, restore it"). When the line was removed, 15 of 77 unit tests (env.test.ts, crypto.test.ts, etc.) failed with `assertServerOnly: this module is server-only.` Cause: env.ts and crypto.ts now call `assertServerOnly()` at module load; happy-dom (the unit project default) provides BOTH `globalThis.window` and `globalThis.window.document`, tripping the runtime guard.
- **Fix:** Restored `vi.mock('server-only', () => ({}))` (cpfServer.ts still imports the package). ADDED `vi.mock('@/lib/serverOnly', () => ({ assertServerOnly: () => {} }))` so env.ts/crypto.ts assertion call is a no-op under happy-dom. Updated `tests/unit/lib/serverOnly.test.ts` to call `vi.unmock('@/lib/serverOnly')` so it exercises the REAL helper (otherwise the global mock would defeat its coverage).
- **Files modified:** `tests/setup.ts` (kept original mock + added new one + comment block); `tests/unit/lib/serverOnly.test.ts` (added vi.unmock at top).
- **Verification:** All 77 unit tests GREEN; serverOnly.test.ts itself 4/4 GREEN (real helper exercised); env.test.ts 13/13 GREEN; crypto.test.ts 7/7 GREEN.
- **Committed in:** `67f6222` (Task 8 commit — bundled with the rollback fixture changes)

**3. [Rule 3 - Blocking] Add `export {};` to fixture scripts to satisfy tsc isolatedModules**

- **Found during:** Task 8 (typecheck after `tests/fixtures/env-runner/env-runner.ts` rewrite)
- **Issue:** tsc emitted `tests/fixtures/env-runner/env-runner.ts(16,16): error TS2393: Duplicate function implementation.` and `tests/fixtures/server-only/import-server-modules.ts(16,16): error TS2393: Duplicate function implementation.` Both files declare a top-level `async function main()`. Without an `import` or `export` statement, tsc treats them as global scripts under `tsconfig.include='tests/**/*.ts'` and the two `main` declarations collide.
- **Fix:** Added `export {};` (a no-op marker) to the top of each fixture file's main body. Marks each as a module so its top-level declarations are file-scoped. The `await import(...)` calls at runtime are unaffected.
- **Files modified:** `tests/fixtures/env-runner/env-runner.ts`, `tests/fixtures/server-only/import-server-modules.ts`.
- **Verification:** `pnpm typecheck` exits 0; both fixture-driven integration tests (env-assert 3/3, server-only-tsx-subprocess 1/1) GREEN.
- **Committed in:** `b5e93ab` (Task 6, for import-server-modules.ts) + `67f6222` (Task 8, for env-runner.ts).

---

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 2 Rule 3 blocking).
**Impact on plan:**
- Deviation 1 contradicts must_have #3 directly. The contradiction is intrinsic to the plan's design (the leaf import literally cannot coexist with tsx-loadability under Node CJS resolution). Documented with a forward-pointer in the helper's JSDoc and in this SUMMARY for any future verifier or re-planner. Defense-in-depth is still in place via cpfServer.ts + the walker.
- Deviation 2 was pre-authorized by the plan ("If any test breaks, restore it"). The deeper `@/lib/serverOnly` mock is the natural extension and is documented inline in tests/setup.ts.
- Deviation 3 is a tooling-housekeeping fix unrelated to the plan's substantive goals.

## Issues Encountered

- **Worker boot probe via PowerShell `Start-Process pnpm`:** Powershell cannot directly launch `pnpm` (.cmd shim) without a shell intermediary; `Start-Process` raised "Esse comando não pode ser executado". Pivoted to `bash -c "timeout 12 pnpm start:worker > worker.stdout.log 2> worker.stderr.log"`, which worked. The probe captured the post-fix behavior cleanly: stderr contains `connect ECONNREFUSED 127.0.0.1:5432` (expected — no local Postgres) and ZERO matches for "Client Component". Worker booted past the env+crypto load surface, reached pg-boss DB connection, failed there (out of scope).
- **Test counts vs `must_have truth #6`:** must_have truth #6 expected the cpf-client-isolation second `it()` block to assert `violations.length > 0`. Walking from `cpfServer.ts` after Task 4 produces 7 violations (cpfServer → @/lib/crypto, cpfServer → @/lib/serverOnly, transitively env, etc.) — well over the threshold. Both walker assertions remain GREEN.

## User Setup Required

None — this is a code-only gap-closure plan. The user already has `.env.local` populated from prior phases.

## Verification Results (Task 9 Smoke)

| Step | Command | Result |
|------|---------|--------|
| 1. Typecheck | `pnpm typecheck` | exit 0, no errors |
| 2. Full unit suite | `npm run test:unit -- --reporter=dot` | 16 files / 77 tests GREEN |
| 3a. Integration: env-assert | `npm run test:integration -- env-assert --reporter=dot` | 3/3 GREEN |
| 3b. Integration: server-only-tsx-subprocess | `npm run test:integration -- server-only-tsx-subprocess --reporter=dot` | 1/1 GREEN (486ms) |
| 4. Worker boot probe | `timeout 12 pnpm start:worker > worker.stdout.log 2> worker.stderr.log` then `grep -c "Client Component" worker.stderr.log` | exit 12 (timeout); grep returns `0` |
| 4-alt. Inline tsx env probe | `npx tsx --env-file-if-exists=.env.local -e "import('./src/lib/env').then(...)"` | stdout: `ENV_OK`, exit 0 |

**Static guards:**

- `grep -nE "^import 'server-only'" src/lib/env.ts src/lib/crypto.ts src/lib/serverOnly.ts src/lib/cpfServer.ts` → 1 match: `src/lib/cpfServer.ts:13:import 'server-only';` (env.ts/crypto.ts/serverOnly.ts all clean; cpfServer.ts retains it as designed).
- `grep -nE "tsx --env-file-if-exists=\.env(\s|\")" package.json` → 0 matches that aren't `.env.local`.
- `grep -nE "tsx --env-file-if-exists=\.env\.local" package.json` → 3 matches (start:worker, test:e2e, db:migrate) as expected.
- Reverse guard `grep -rln "'use client'" src/ | xargs grep -l "from '@/lib/serverOnly'"` → empty (no `'use client'` module imports the helper).

**Confirmation that 02-VERIFICATION.md row 8 (cpf-client-isolation regression) is preserved.** Walker now flags 7 violations from `cpfServer.ts` (the sanity-check entry point) — well above the `> 0` threshold. The first assertion (`@/lib/cpf does not transitively import @/lib/env or @/lib/crypto`) still passes — the cpf module remains isomorphic and free of server-only imports.

## Next Phase Readiness

- **Phase 02 plan 10 closes the worker-boot gap** identified in `02-HUMAN-UAT.md` Test 1. Other UAT tests (Tests 3-7) remain blocked on the per-suite truncation + migration regression follow-up tracked in STATE.md after plan 02-09 — out of scope for this plan.
- **User should re-run UAT Tests 1-7 (`/gsd-verify-work` continuation) — this plan unblocks Test 1 only; Tests 3-7 remain blocked on the per-suite truncation/migration follow-up tracked in STATE.md after plan 02-09.**
- Phase 02 (pluggy-ingestion) is complete (10 plans + this gap closure). Phase 03 (categorization) is next plannable.

## Self-Check: PASSED

Verifying claims in this SUMMARY against disk and git history.

**Files claimed created — all exist:**

- `src/lib/serverOnly.ts` → FOUND
- `tests/unit/lib/serverOnly.test.ts` → FOUND
- `tests/integration/observability/server-only-tsx-subprocess.test.ts` → FOUND
- `tests/fixtures/server-only/import-server-modules.ts` → FOUND

**Commits claimed — all reachable from HEAD:**

- `303701b` (Task 1) → FOUND
- `517540b` (Task 2) → FOUND
- `bb9ef4e` (Task 3) → FOUND
- `eab12dd` (Task 4) → FOUND
- `7421e29` (Task 5) → FOUND
- `1039518` (Rule 1 deviation, between Task 5 and 6) → FOUND
- `b5e93ab` (Task 6) → FOUND
- `0a7c71c` (Task 7) → FOUND
- `67f6222` (Task 8) → FOUND

**Static contract checks pass.** See "Static guards" subsection above.
