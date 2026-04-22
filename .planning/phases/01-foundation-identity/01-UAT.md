---
status: complete
phase: 01-foundation-identity
source:
  - 01-00-SUMMARY.md
  - 01-01-SUMMARY.md
started: 2026-04-22T21:00:00Z
updated: 2026-04-22T21:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: |
  Kill any running dev server. From a clean working tree, run
  `pnpm install --frozen-lockfile` then `pnpm build`. Both complete
  without errors or peer-dep warnings. No files show as modified in
  `git status` afterward (lockfile frozen, no generated drift).
result: pass

### 2. Unit tests pass
expected: |
  Running `pnpm test:unit` finishes green (scaffold test + any unit
  tests landed under tests/unit/). Typical runtime ~1 s.
result: pass

### 3. Integration tests pass (Docker required)
expected: |
  With Docker Desktop running, `pnpm test:integration` finishes green.
  Includes the scaffold test and the 10 DB tests
  (tests/integration/db/migrations.test.ts + users-schema.test.ts).
  First run pulls postgres:16-alpine (~18 s); subsequent runs ~7 s.
result: pass

### 4. E2E scaffold passes
expected: |
  `pnpm test:e2e` boots `pnpm start:web` via Playwright webServer,
  runs the chromium scaffold spec against http://localhost:3000, and
  finishes green in ~3 s.
result: pass

### 5. Dev server renders pt-BR + teal tokens
expected: |
  `pnpm dev` (or `pnpm start:web` after build) serves
  http://localhost:3000. Page renders with Inter Variable font,
  <html lang="pt-BR">, and the teal primary colour (UI-SPEC § 1.4:
  --primary: 178 84% 28%). No hydration warnings in the console.
result: pass

### 6. Fresh DB migration creates all 14 tables
expected: |
  Against an empty Postgres 16 (via testcontainers in the integration
  suite, OR a local pg you created), `pnpm db:migrate` completes and
  `\dt public.*` lists all 14 Phase 1 tables:
  users, sessions, accounts_oauth, verification_tokens, user_consents,
  audit_log, admin_access_log, webhook_events, subscriptions,
  dsr_requests, auth_rate_limits, account_locks, password_reset_tokens,
  ses_suppressions. There is NO `accounts` table (Pluggy name reserved).
  `pgcrypto` extension is installed.
result: pass
note: "Verified standalone via throwaway docker postgres:16-alpine on port 5433. DATABASE_URL set, pnpm db:migrate completed. Also equivalently covered by tests/integration/db/migrations.test.ts (Test 3)."

### 7. Migration idempotence
expected: |
  Running `pnpm db:migrate` a second time against the already-migrated
  DB completes without error and without schema drift (the migrations
  integration test asserts this — information_schema snapshot before
  and after the second run is identical).
result: pass

### 8. drizzle-kit push is NOT available
expected: |
  `package.json` scripts expose `db:generate` and `db:migrate` only.
  There is no `db:push` script and no accidental `drizzle-kit push`
  invocation anywhere. (T-MIGRATION-DRIFT mitigation.)
result: pass
note: "package.json has db:generate, db:migrate, and db:studio (read-only) — no db:push. The only reference to `drizzle-kit push` in the codebase is src/db/migrate.ts:18 — an explicit ban comment."

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
