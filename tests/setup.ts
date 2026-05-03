import '@testing-library/jest-dom/vitest';
import { loadEnvConfig } from '@next/env';
import { vi } from 'vitest';

// Plan 02-07 added `import 'server-only'` to src/lib/env.ts and src/lib/crypto.ts.
// Plan 02-10 moved the package import to src/lib/serverOnly.ts then later
// REMOVED it from serverOnly.ts entirely (Rule 1 deviation — see SUMMARY) so
// tsx-direct entrypoints (worker, db:migrate, e2e) could load env.ts/crypto.ts
// without crashing. The remaining direct importer of `'server-only'` is
// src/lib/cpfServer.ts (defense-in-depth at the cpf chain leaf).
//
// Plan 02-10 Task 8 ROLLBACK PATH — applied: keep BOTH mocks below.
//
// 1) `vi.mock('server-only', () => ({}))` — covers cpfServer.ts's direct
//    package import. Without it, any unit test that imports cpfServer.ts
//    (or anything reaching it) crashes when Node CJS loads the throwing
//    server-only/index.js.
//
// 2) `vi.mock('@/lib/serverOnly', () => ({ assertServerOnly: () => {} }))`
//    — covers env.ts and crypto.ts which now call `assertServerOnly()` at
//    module load. Under happy-dom (the unit project default), window AND
//    window.document are defined, so the runtime check would throw. The
//    no-op mock keeps existing env.test.ts / crypto.test.ts / etc. passing
//    without forcing every test file to mutate globalThis.window.
//
// `tests/unit/lib/serverOnly.test.ts` exercises the REAL helper by calling
// `vi.unmock('@/lib/serverOnly')` in its hoisted block, so the mock here
// does not affect the helper's own coverage.
//
// Production behavior is unchanged: Next.js still applies its webpack alias
// and any client bundle that imports a server-only module fails the build
// (currently enforced at cpfServer.ts and via the cpf-client-isolation walker
// extending FORBIDDEN_FROM_CLIENT to include @/lib/serverOnly).
//
// To remove these mocks cleanly, every consumer test that loads
// env.ts/crypto.ts/cpfServer.ts under happy-dom would need to either delete
// globalThis.window before importing or apply a per-file mock. Tracked as a
// follow-up; out of scope for plan 02-10.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/serverOnly', () => ({
  assertServerOnly: () => {
    /* no-op for happy-dom unit tests */
  },
}));

loadEnvConfig(process.cwd());

// Default test env values — keep in sync with src/lib/env.ts (created in plan 01-01).
// Pure Vitest (`test` env) and Next.js dev runs both rely on these defaults.
//
// NODE_ENV is typed as a readonly union in @types/node 22+. Cast through
// Record<string, string> to set it; Vitest itself sets NODE_ENV=test before
// this file runs, so the assignment is normally a no-op safety net.
(process.env as Record<string, string>).NODE_ENV =
  process.env.NODE_ENV ?? 'test';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? Buffer.alloc(32, 1).toString('base64');
process.env.CPF_HASH_PEPPER =
  process.env.CPF_HASH_PEPPER ?? 'test-pepper-at-least-32-chars-long-xyz';
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET ?? 'test-secret-at-least-32-chars-long-xxx';
// Test-time defaults for the env loader (lib/env.ts). Integration tests
// override DATABASE_URL with the testcontainers connection string before
// importing modules that touch the DB.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/portal_test';
