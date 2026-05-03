---
phase: 02-pluggy-ingestion
fixed_at: 2026-05-03T00:00:00Z
review_path: .planning/phases/02-pluggy-ingestion/02-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-03
**Source review:** `.planning/phases/02-pluggy-ingestion/02-REVIEW.md`
**Iteration:** 1
**Fix scope:** `critical_warning` (Critical + Warning findings only)

**Summary:**

- Findings in scope: 4 (0 Critical + 4 Warning)
- Fixed: 4
- Skipped: 0
- Out of scope: 6 Info findings (IN-01..IN-06) -- left untouched in REVIEW.md per scope policy

## Fixed Issues

### WR-01: `/api/connect/init` writes consent row before IDOR check, leaving orphaned rows on 404

**Files modified:** `src/app/api/connect/init/route.ts`
**Commit:** `04db118`
**Applied fix:** Reordered the route handler so step 4 (reconnect_item_id IDOR check + 404) runs BEFORE step 5 (INSERT user_consents PLUGGY_CONNECT_PENDING). Updated the file's step-sequence docblock accordingly. This guarantees a 404 on the reconnect path leaves zero new rows in the LGPD audit trail.

**Verification:**
- Tier 1: re-read modified region; reordering and docblock are correct.
- Tier 2: `npx tsc --noEmit` filtered for `src/app/api/connect/init` -- zero errors.

### WR-02: `has_cpf` detection by Buffer length is fragile and silently breaks on format change

**Files modified:** `src/lib/cpf.ts`, `src/app/api/connect/init/route.ts`, `src/app/(auth)/signup/signupCore.ts`, `tests/unit/lib/cpf.test.ts`
**Commit:** `f52025f`
**Applied fix:**
1. Added named exports `CPF_PLACEHOLDER_BYTES = 44` and `CPF_ENCRYPTED_BYTES = 39` to `src/lib/cpf.ts` with a docblock that documents the contract.
2. Switched `route.ts` from `cpf_enc.byteLength !== 44` (matches anything-not-44) to `cpf_enc.byteLength === CPF_ENCRYPTED_BYTES` (fails closed if shape ever changes).
3. Switched `signupCore.ts` placeholder from inline `randomBytes(44)` to `randomBytes(CPF_PLACEHOLDER_BYTES)` so both sides share the constant.
4. Added a `CPF storage byte-length contract` describe block to `cpf.test.ts` that pins both constants and asserts they remain distinct.

**Verification:**
- Tier 1: re-read all four modified files; constants are referenced consistently.
- Tier 2: `npx tsc --noEmit` filtered to project files -- zero errors.
- Tier 2 (tests): `npx vitest run tests/unit/lib/cpf.test.ts` -- all 9 tests pass (3 new + 6 pre-existing).

### WR-03: `ENCRYPTION_KEY` regex accepts URL-safe base64 but `Buffer.from(s, 'base64')` cannot decode it

**Files modified:** `src/lib/env.ts`, `tests/unit/lib/env.test.ts`
**Commit:** `442b239`
**Applied fix:**
1. Tightened the `ENCRYPTION_KEY` regex from `/^[A-Za-z0-9+/=_-]+$/` to `/^[A-Za-z0-9+/]+={0,2}$/` so the URL-safe alphabet (`-`, `_`) is rejected at parse time. Updated the inline docblock to call out the silent-corruption risk that motivated the change.
2. Added a `WR-03 regression guard` test that builds two URL-safe inputs (one containing `_` substituted for `/`, one containing `-` substituted for `+`) and asserts both reject with the new `standard base64` error message. Each inner iteration calls `vi.resetModules()` + `resetEnv()` so the second `import('@/lib/env')` re-runs Zod parsing.

**Verification:**
- Tier 1: re-read regex + test; the `+` and `/` markers in the test inputs are confirmed via `.toMatch` assertions.
- Tier 2 (tests): `npx vitest run tests/unit/lib/env.test.ts` -- all 13 tests pass (1 new + 12 pre-existing OPS-04 / SEC-02 cases).

### WR-04: Trust-on-first-write of `x-forwarded-for` for LGPD audit `ip_address`

**Files modified:** `src/app/api/connect/init/route.ts`
**Commit:** `0aacb8f`
**Applied fix (inline tightening + documented TODO):** Replaced the raw `req.headers.get('x-forwarded-for') ?? null` write with a parse that takes the leftmost entry of the comma-separated list, trims whitespace, and falls back to `null` when the header is absent or empty. Added a `TODO(SEC, review WR-04)` comment that captures the deferred work: introduce a `getClientIp(req)` helper that consults a `TRUSTED_PROXY` env flag and falls back to a Node-level remote address. Per orchestrator instructions, the helper itself is NOT part of this fix -- the inline tightening alone closes the comma-list smuggling vector while the broader trust-boundary work is tracked in code.

**Verification:**
- Tier 1: re-read modified region; `client_ip` is computed exactly once and consumed by the `user_consents` insert.
- Tier 2: `npx tsc --noEmit` filtered to `src/app/api/connect/init` -- zero errors.

## Out-of-Scope Findings (untouched)

The following 6 Info findings were filtered out by the `critical_warning` scope and remain documented in `02-REVIEW.md` for a future iteration:

- **IN-01:** Inconsistent pepper encoding in `crypto.ts` (`string` vs `Buffer.from(pepper, 'utf8')`).
- **IN-02:** Dead `booted` local in `tests/fixtures/integration-globals.ts`.
- **IN-03:** `cpf-client-isolation.test.ts` regex misses dynamic `import()` and `require()` calls.
- **IN-04:** `package.json` `start:worker` env-file order is opposite of `.env.example` comment.
- **IN-05:** `env-runner.ts` patches `Module._cache` via `as any` -- undocumented Node internals dependency.
- **IN-06:** `env.ts` reads `process.env.NEXT_PHASE` directly inside refines instead of validating it on the schema.

None of these block merge; they are surfaced for follow-up at the next refactor pass.

---

_Fixed: 2026-05-03_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
