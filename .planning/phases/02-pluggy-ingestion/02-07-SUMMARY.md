---
phase: 02-pluggy-ingestion
plan: 07
subsystem: web/security
tags: [pluggy, security, server-only, cpf, lgpd, gap-closure]
gap_closure: true
requirements: [LGPD-02, CONN-01, SEC-01]
dependency_graph:
  requires:
    - 02-01
    - 02-02
    - 02-03
    - 02-04
    - 02-05
    - 02-06
  provides:
    - cpf-client-isolation
    - server-only-env-guard
  affects:
    - /connect (UAT Test 1 unblocked at the bundle-leak layer)
tech_stack:
  added:
    - server-only (1.0.0) — Next.js client/server boundary marker
  patterns:
    - "Module-level `import 'server-only';` guard for env / crypto modules"
    - "Isomorphic schema (cpf.ts) vs server-only wrapper (cpfServer.ts) split"
    - "Static import-graph walker as a regression-style unit test"
key_files:
  created:
    - src/lib/cpfServer.ts
    - tests/unit/lib/cpf-client-isolation.test.ts
  modified:
    - src/lib/env.ts
    - src/lib/crypto.ts
    - src/lib/cpf.ts
    - src/app/api/connect/init/route.ts
    - package.json
    - pnpm-lock.yaml
decisions:
  - "Installed `server-only` explicitly (was not present transitively in this workspace despite Next 16.2.4)"
  - "CPFSchema + formatCPF stay in @/lib/cpf (isomorphic); encryptAndHashCPF moved to @/lib/cpfServer (server-only)"
  - "Regression guard is a static import-graph walker — vitest's happy-dom cannot reproduce the real Next client-bundle boundary"
metrics:
  duration_minutes: 6
  completed_date: 2026-05-02
  tasks_completed: 3
  files_touched: 7
  commits: [a462051, 1820b3a, 6f7c4ed]
---

# Phase 02 Plan 07: web /connect ZodError + server-only env leak — gap closure summary

One-liner: split @/lib/cpf into an isomorphic schema module and a new server-only @/lib/cpfServer wrapper, lock @/lib/env and @/lib/crypto with `import 'server-only';`, and add a static import-graph regression test that fails if the server graph ever leaks back into the client bundle.

## Outcome

- All three tasks executed and committed atomically.
- Eliminated the primary cause of the /connect ZodError (UAT Test 1 Gap 1): ConnectIsland → ConsentScreen → @/lib/cpf → @/lib/crypto → @/lib/env no longer reaches the server-only env loader.
- Failure mode upgraded from "runtime ZodError in the browser console" to "Next.js compile-time error" if the boundary is violated again.
- Existing tests/unit/lib/cpf.test.ts (6 tests) still passes unchanged. New tests/unit/lib/cpf-client-isolation.test.ts (2 tests) passes.
- pnpm typecheck clean.

## Task-by-task changes

### Task 1 — lock env.ts and crypto.ts to server-only (commit `a462051`)

- `pnpm why server-only` and `node -e "require.resolve('server-only')"` both reported the package was NOT resolvable in this workspace, despite the plan's expectation that it ships transitively with `next 16.2.4`. Installed it explicitly with `pnpm add server-only` (added 1 direct dep + a few transitive workspace updates; tracked in package.json + pnpm-lock.yaml).
- `src/lib/env.ts` — inserted `import 'server-only';` as line 25, immediately after the JSDoc block (lines 1–24) and BEFORE `import { z } from 'zod';`. Schema body, refine blocks, and exports untouched.
- `src/lib/crypto.ts` — inserted `import 'server-only';` as line 18, immediately after the JSDoc block (lines 1–17) and BEFORE the `node:crypto` named imports. Helper bodies untouched.
- Verified via `node -e "..."` regex check: both files now begin with `import 'server-only';` as their first executable statement.

### Task 2 — split cpf.ts into isomorphic + server-only modules (commit `1820b3a`)

- `src/lib/cpf.ts` rewritten to be fully isomorphic:
  - Imports: only `zod` and `@brazilian-utils/brazilian-utils`.
  - Exports: `CPFSchema`, `formatCPF`.
  - Removed: `import { encryptCPF, hashCPF } from '@/lib/crypto'` and the `encryptAndHashCPF` function (lines 21 + 35–50 of the previous file).
- `src/lib/cpfServer.ts` created (21 lines):
  - First non-comment statement is `import 'server-only';`.
  - Imports `encryptCPF, hashCPF` from `@/lib/crypto`.
  - Exports `encryptAndHashCPF(cpf: string): { cpf_enc: Buffer; cpf_hash: Buffer }`.
- `src/app/api/connect/init/route.ts` line 34 split into two import sites:
  ```typescript
  import { CPFSchema } from '@/lib/cpf';
  import { encryptAndHashCPF } from '@/lib/cpfServer';
  ```
  No other line of the route changed.
- `src/components/consent/ConsentScreen.tsx` confirmed to import only `CPFSchema` from `@/lib/cpf` — no edit needed.
- Sanity grep for `encryptAndHashCPF` across `src/` + `tests/` returned exactly the two expected sites (export in `cpfServer.ts`, import in `connect/init/route.ts`), plus the function body line and the comment in cpf.ts before the rewrite — confirmed clean after rewrite.
- `npm run test:unit -- cpf` — 6/6 pass.

### Task 3 — regression test for cpf client isolation (commit `6f7c4ed`)

- `tests/unit/lib/cpf-client-isolation.test.ts` (108 lines) created exactly per plan spec.
- Approach: static import-graph walker rooted at `src/lib/cpf.ts`. Recursively follows `@/`, `./`, `../` import specifiers, asserts the visited set never imports `@/lib/env`, `@/lib/crypto`, or `@/lib/cpfServer`. Bare specifiers (npm packages) are deliberately out of scope.
- Includes a self-check second test that walks `src/lib/cpfServer.ts` (which DOES import `@/lib/crypto`) and asserts the walker reports at least one violation — guards against a silently broken regex/resolver greenwashing the primary assertion.
- `npm run test:unit -- cpf-client-isolation` — 2/2 pass.

## Manual verification

The plan's manual `pnpm dev` + visit /connect smoke test was NOT performed in this execution because:
- The dev environment still lacks `.env.local` (covered by **plan 02-08**).
- Without those env vars, the server-side `EnvSchema.parse(process.env)` still throws on cold start regardless of this plan's fix.

This plan addresses ONE of the two compounding root causes diagnosed in `.planning/debug/connect-env-zoderror.md` — the bundle-leak side. The dev env-file side is sequenced into 02-08; the testcontainers/env-runner fixture drift into 02-09. Full UAT re-run for Test 1 is gated on those two follow-up plans.

## Acceptance proof set status

1. ✅ Static guard: `grep -n "import 'server-only'" src/lib/env.ts src/lib/crypto.ts src/lib/cpfServer.ts` returns 3 matches.
2. ✅ Codemod: ripgrep proves no `'use client'` file imports `@/lib/env`, `@/lib/crypto`, or `@/lib/cpfServer` directly.
3. ✅ Unit test: `npm run test:unit -- cpf-client-isolation` passes.
4. ⏭ Build smoke (`pnpm dev` + /connect with no ZodError): deferred to after 02-08 lands.

## Cross-links

- **02-08** — env-assert good-path fixture refresh + `.env.example` documentation update; required to make dev `pnpm dev` boot cleanly.
- **02-09** — testcontainers infra fix; required to unblock the integration + E2E suites for full UAT re-run.

Without 02-08 + 02-09, UAT Test 1 will still fail at the dev env-loading layer or in CI. With this plan alone, the *bundle-leak* class of the bug is closed and guarded against regression.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `server-only` package not present in workspace**
- Found during: Task 1 setup
- Issue: Plan claimed `server-only` would resolve transitively from `next` 16.2.4. `node -e "require.resolve('server-only')"` returned `Cannot find module 'server-only'`.
- Fix: Ran `pnpm add server-only` per the plan's pre-authorized fallback ("if absent, install via `pnpm add server-only`").
- Files modified: package.json, pnpm-lock.yaml.
- Commit: `a462051` (combined with the env.ts + crypto.ts edits as the plan permitted).

No other deviations. Plan executed exactly as specified.

## Self-Check: PASSED

Verified files:
- ✅ `src/lib/env.ts` — `import 'server-only';` at line 25
- ✅ `src/lib/crypto.ts` — `import 'server-only';` at line 18
- ✅ `src/lib/cpf.ts` — isomorphic, no `@/lib/*` imports
- ✅ `src/lib/cpfServer.ts` — created, `import 'server-only';` at line 13
- ✅ `src/app/api/connect/init/route.ts` — two import sites updated
- ✅ `tests/unit/lib/cpf-client-isolation.test.ts` — created (108 lines), 2/2 tests pass
- ✅ `tests/unit/lib/cpf.test.ts` — unchanged, 6/6 tests still pass
- ✅ `pnpm typecheck` — clean

Verified commits in `git log --oneline`:
- ✅ `a462051` fix(02-07): lock env.ts and crypto.ts to server-only via 'server-only' package
- ✅ `1820b3a` refactor(02-07): split cpf.ts — isomorphic schema vs server-only encryption
- ✅ `6f7c4ed` test(02-07): add cpf client-isolation regression test
