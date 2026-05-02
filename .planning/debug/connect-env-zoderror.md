---
status: diagnosed
trigger: "/connect renders ZodError at module evaluation; same ZodError surfaces in browser console; OPS-04 env-assert good-path subprocess exits 1 instead of 0"
created: 2026-05-02T00:00:00Z
updated: 2026-05-02T00:00:00Z
---

## Current Focus

hypothesis: TWO INDEPENDENT BUGS COMPOUND. (A) `src/lib/env.ts` has no `import 'server-only'` guard and is imported transitively from `'use client'` `ConsentScreen` via `@/lib/cpf` -> `@/lib/crypto` -> `@/lib/env`. The `EnvSchema.parse(process.env)` runs in the client bundle where `process.env` is an empty object, so Zod throws missing/`undefined` for every required field, surfacing both server-side (because the client component is rendered on SSR too) and in the browser (uncaught ZodError). (B) Local dev has no `.env.local`/`.env`/`.env.development` file in the repo root — only `.env.example`. Next.js 16 dev auto-loads `.env*` if present, but nothing is present, so even the server side has no `DATABASE_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CPF_HASH_PEPPER`. Server still fails the same parse. The `NODE_ENV invalid_value` (rather than `invalid_type`) on the browser side is consistent with Zod v4 enum reporting on `undefined` (or empty string injected by Next's dev fallback). Also: env-assert "good path" subprocess exits 1 because commit `65c88fc` extended the prod schema (Pluggy creds + PLUGGY_ITEM_ID_HASH_PEPPER required for SERVICE_NAME=web|worker in production) but `goodProductionEnv()` fixture in `tests/integration/observability/env-assert.test.ts` was never updated to include those fields.
test: confirmed by reading: (1) `src/lib/env.ts` (no server-only guard, top-level parse), (2) `src/lib/crypto.ts` line 24 imports env, (3) `src/lib/cpf.ts` line 21 imports `encryptCPF, hashCPF` from crypto, (4) `src/components/consent/ConsentScreen.tsx` line 28 imports `CPFSchema` from `@/lib/cpf`, (5) `src/app/connect/ConnectIsland.tsx` (`'use client'`) imports ConsentScreen; (6) repo root has only `.env.example`, no `.env*` files; (7) env-runner fixture missing PLUGGY_* fields that schema now requires in prod for web/worker.
expecting: Both root causes confirmed.
next_action: Write debug file resolution and return ROOT CAUSE FOUND.

## Symptoms

expected: /connect renders the Pluggy Connect entry point in dev with no env runtime errors; env validation runs server-side only; required vars (NODE_ENV, DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY, CPF_HASH_PEPPER) load from .env files before module evaluation.
actual: ZodError at module evaluation on SSR for /connect; same uncaught ZodError shows in browser console; 5 issues — NODE_ENV invalid_value (enum dev|staging|prod|test); DATABASE_URL/NEXTAUTH_SECRET/ENCRYPTION_KEY/CPF_HASH_PEPPER all invalid_type (undefined). OPS-04 env-assert "good path" subprocess exits 1 instead of 0.
errors:
  - NODE_ENV: invalid_value (enum: development|staging|production|test)
  - DATABASE_URL: invalid_type (string, undefined)
  - NEXTAUTH_SECRET: invalid_type (string, undefined)
  - ENCRYPTION_KEY: invalid_type (string, undefined)
  - CPF_HASH_PEPPER: invalid_type (string, undefined)
reproduction: pnpm dev (Next 16.2.4 turbopack, Node v24), navigate to /connect after sign-in.
started: After commit b22134f (Node v24 bump + worker env-file loading fix); web side env loading not addressed.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-05-02
  checked: src/lib/env.ts
  found: Module declares "SERVER-ONLY" in a leading comment but does NOT call `import 'server-only'`. Top-level `EnvSchema.parse(process.env)` runs eagerly on every import. Schema requires NODE_ENV/DATABASE_URL/NEXTAUTH_SECRET/ENCRYPTION_KEY/CPF_HASH_PEPPER unconditionally. Production OPS-04 refines additionally require PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV=production, PLUGGY_ITEM_ID_HASH_PEPPER for SERVICE_NAME web/worker (lines 175-192).
  implication: Without the `server-only` import marker, Next.js does NOT prevent this module from being bundled into client chunks. Any `'use client'` boundary that transitively imports it will execute the parse in the browser.
- timestamp: 2026-05-02
  checked: src/lib/crypto.ts
  found: Line 24 imports `env` from `@/lib/env`, also imports `node:crypto` at top. Module sits at server-only abstraction level but has NO `import 'server-only'` guard.
  implication: Pulls env into anything that imports crypto, AND if bundled to client would error on `node:crypto`.
- timestamp: 2026-05-02
  checked: src/lib/cpf.ts
  found: Line 21 imports `{ encryptCPF, hashCPF }` from `@/lib/crypto`. Exports `CPFSchema` (zod) AND `encryptAndHashCPF`. No `server-only` guard.
  implication: Any client component importing CPFSchema also drags crypto + env into the client bundle. CPFSchema is the only client-needed export.
- timestamp: 2026-05-02
  checked: src/components/consent/ConsentScreen.tsx
  found: First line `'use client'`. Line 28: `import { CPFSchema } from '@/lib/cpf';`. Used only for `safeParse` validation in handleSubmit.
  implication: Client island ConsentScreen pulls CPFSchema -> drags crypto -> drags env into client bundle. CONFIRMED IMPORT CHAIN: ConnectIsland (client) -> ConsentScreen (client) -> @/lib/cpf -> @/lib/crypto -> @/lib/env (with top-level parse).
- timestamp: 2026-05-02
  checked: src/app/connect/ConnectIsland.tsx
  found: First line `'use client'`. Imports ConsentScreen and PluggyConnectWidget.
  implication: Renders on SSR (because the parent `connect/page.tsx` is an RSC) AND ships to client; both sides hit the env parse.
- timestamp: 2026-05-02
  checked: repo root listing for `.env*`
  found: Only `.env.example` exists. No `.env`, `.env.local`, `.env.development`, or `.env.development.local`.
  implication: `next dev` has no env file to load locally. Server-side `process.env.DATABASE_URL` etc. are undefined. NODE_ENV is set automatically by `next dev` to 'development' (server side), so server's NODE_ENV check passes but DATABASE_URL/NEXTAUTH_SECRET/ENCRYPTION_KEY/CPF_HASH_PEPPER fail with `invalid_type: undefined`. The browser side has empty `process.env`, so NODE_ENV ALSO fails (with `invalid_value` for an empty/undefined value under Zod 4 enum semantics).
- timestamp: 2026-05-02
  checked: next.config.ts
  found: `env: { NEXT_PUBLIC_PLUGGY_ENV: process.env.NEXT_PUBLIC_PLUGGY_ENV ?? '' }` is the only client-bundled env. None of the schema's required server vars are exposed (correctly so — they are secrets), so the client bundle has no way to satisfy the schema even with .env files present.
  implication: The fix is NOT to expose server secrets to the client. The fix is to keep env.ts off the client bundle entirely (server-only guard + restructured CPFSchema export so client code never transitively pulls server modules).
- timestamp: 2026-05-02
  checked: tests/integration/observability/env-assert.test.ts and tests/fixtures/env-runner/env-runner.ts
  found: `goodProductionEnv()` (lines 23-39) does NOT include PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV=production, or PLUGGY_ITEM_ID_HASH_PEPPER. SERVICE_NAME is unset so it defaults to 'web'. The new prod refinement at env.ts:175-192 fires and rejects the fixture with the OPS-04 Pluggy violation message. env-runner's `process.exit(1)` writes the message to stderr → status=1, test expects status=0.
  implication: Independent fixture-vs-schema drift introduced by commit 65c88fc (`feature(pluggy): install Pluggy SDKs, extend env validation, register Phase 2 queues`). Same root family as the dev crash because both stem from env.ts schema being authoritative + non-aligned consumers, but the fix is independent: update fixture to set PLUGGY_* fields (or set SERVICE_NAME='migrate' to bypass the web/worker gate; updating the fixture is the correct fix to keep production coverage).
- timestamp: 2026-05-02
  checked: git log src/lib/env.ts
  found: Commit 65c88fc extended schema with the prod Pluggy refinement; commit 023bfd8 introduced env.ts originally; no commit ever added an `import 'server-only'` guard.
  implication: This is a latent bug from inception. It was masked in Phase 1 because no client-side component transitively imported env.ts; Phase 2's ConsentScreen + CPFSchema refactor is the first client component to reach it.

## Resolution

root_cause: |
  PRIMARY (web /connect crash): The server-only env loader `src/lib/env.ts` lacks the `import 'server-only'` guard and runs `EnvSchema.parse(process.env)` at module load. The client component `src/components/consent/ConsentScreen.tsx` (`'use client'`) imports `CPFSchema` from `src/lib/cpf.ts`, which transitively imports `src/lib/crypto.ts`, which imports `@/lib/env`. As a result, env.ts is pulled into the client bundle through the `ConnectIsland` -> `ConsentScreen` -> `cpf` -> `crypto` -> `env` chain. In the browser, `process.env` is an empty object (Next.js only inlines `NEXT_PUBLIC_*` substitutions), so all required fields throw — `NODE_ENV` reports as `invalid_value` (Zod v4 enum rejection of undefined/empty), and `DATABASE_URL`/`NEXTAUTH_SECRET`/`ENCRYPTION_KEY`/`CPF_HASH_PEPPER` report as `invalid_type` (undefined). The same crash also surfaces during SSR because the dev environment has no `.env.local` (only `.env.example` exists), so the same vars are also undefined on the server.
  SECONDARY (env-assert good-path test): Independent regression. Commit 65c88fc extended the prod env schema to require Pluggy creds for SERVICE_NAME=web|worker, but `goodProductionEnv()` in `tests/integration/observability/env-assert.test.ts` was never updated to include the new fields. The fixture is rejected by the schema -> subprocess exits 1 -> test fails.
fix: |
  (Diagnosis only — fix to be planned by /gsd-plan-phase --gaps.) Direction:
    1. Move CPFSchema (and `formatCPF`) into a pure-client/isomorphic module that imports nothing from `@/lib/crypto` or `@/lib/env`. Keep `encryptAndHashCPF` (the server-only export) in a separate file under e.g. `src/lib/cpfServer.ts`. Add `import 'server-only'` to env.ts, crypto.ts, and the new cpfServer.ts.
    2. Create `.env.local` (or `.env.development.local`) at repo root with the five required vars (DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY, CPF_HASH_PEPPER, NEXTAUTH_URL) for local dev, OR add a `dev` script that uses `next dev --env-file=.env.local`. Document this in README and `.env.example` (mark them required for local dev).
    3. Update `goodProductionEnv()` in env-assert.test.ts to include PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_WEBHOOK_SECRET, PLUGGY_ENV=production, PLUGGY_ITEM_ID_HASH_PEPPER. Or add SERVICE_NAME='migrate' if testing the non-web path is intended (probably not — keep web coverage and add the fields).
    4. Optional hardening: add a unit test that asserts no `'use client'` module transitively imports `@/lib/env` (regression guard for this exact bug class).
verification: (deferred — diagnosis only)
files_changed: []

