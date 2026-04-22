import '@testing-library/jest-dom/vitest';
import { loadEnvConfig } from '@next/env';

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
