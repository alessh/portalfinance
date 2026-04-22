import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Env loader tests — RESEARCH.md § Plan slice 01-04 item 5 (OPS-04 guard).
 *
 * `src/lib/env.ts` parses `process.env` at module load time. To test
 * different environments we must reset `process.env` and re-import the
 * module via `vi.resetModules()` for each scenario.
 */

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

describe('lib/env (Zod schema + OPS-04 guard)', () => {
  beforeEach(async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('throws when ENCRYPTION_KEY does not decode to 32 bytes', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(8, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'test-pepper-at-least-32-chars-long-xyz';
    process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-chars-long-xxx';
    process.env.DATABASE_URL = 'postgres://x:y@localhost:5432/db';
    (process.env as Record<string, string>).NODE_ENV = 'test';

    await expect(import('@/lib/env')).rejects.toThrow();
  });

  it('throws an OPS-04 violation when NODE_ENV=production with sandbox PLUGGY_ENV', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    process.env.SENTRY_DSN = 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN';
    process.env.SENTRY_ENV = 'production';
    process.env.PLUGGY_ENV = 'sandbox';
    (process.env as Record<string, string>).NODE_ENV = 'production';

    await expect(import('@/lib/env')).rejects.toThrow(/OPS-04/);
  });

  it('parses cleanly for a development-shape env', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'test-pepper-at-least-32-chars-long-xyz';
    process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-chars-long-xxx';
    process.env.DATABASE_URL = 'postgres://x:y@localhost:5432/db';
    (process.env as Record<string, string>).NODE_ENV = 'development';

    const mod = await import('@/lib/env');
    expect(mod.env.NODE_ENV).toBe('development');
    expect(mod.env.AWS_REGION).toBe('sa-east-1');
  });
});
