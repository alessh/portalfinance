import '@testing-library/jest-dom/vitest';
import { loadEnvConfig } from '@next/env';
import { vi } from 'vitest';

// Plan 02-07 added `import 'server-only'` to src/lib/env.ts and src/lib/crypto.ts.
// The `server-only` package throws unconditionally in any non-React-Server-Component
// context — including vitest, which loads modules through Node's CJS resolver where
// the `react-server` export condition does not fire. Mirroring the test-fixture
// stub pattern used by tests/fixtures/env-runner/env-runner.ts, replace the module
// with an empty no-op so test files can import server-side modules. Production
// behavior is unchanged: Next.js still applies its webpack alias and any client
// bundle that imports a server-only module fails the build.
vi.mock('server-only', () => ({}));

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
