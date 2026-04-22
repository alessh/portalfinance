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
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.TURNSTILE_SITE_KEY = 'prod-site-key';
    process.env.TURNSTILE_SECRET_KEY = 'prod-secret-key';
    process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY = 'prod-public-site-key';
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

  // Plan 01-04 additions — OPS-04 hardening
  it('OPS-04: throws when NODE_ENV=production with SENTRY_DSN not matching .sentry.io', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    // Bad DSN: points at a non-sentry.io hostname
    process.env.SENTRY_DSN = 'https://abc@NNNN.ingest.malicious.io/PNNNN';
    process.env.SENTRY_ENV = 'production';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.TURNSTILE_SITE_KEY = 'prod-site-key';
    process.env.TURNSTILE_SECRET_KEY = 'prod-secret-key';
    process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY = 'prod-public-site-key';
    (process.env as Record<string, string>).NODE_ENV = 'production';

    await expect(import('@/lib/env')).rejects.toThrow(/OPS-04/);
  });

  it('OPS-04: throws when NODE_ENV=production with SENTRY_ENV=staging', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    process.env.SENTRY_DSN = 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN';
    // Bad: SENTRY_ENV is staging, not production
    process.env.SENTRY_ENV = 'staging';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.TURNSTILE_SITE_KEY = 'prod-site-key';
    process.env.TURNSTILE_SECRET_KEY = 'prod-secret-key';
    process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY = 'prod-public-site-key';
    (process.env as Record<string, string>).NODE_ENV = 'production';

    await expect(import('@/lib/env')).rejects.toThrow(/OPS-04/);
  });

  it('OPS-04: throws when NODE_ENV=production with PLUGGY_ENV=sandbox', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    process.env.SENTRY_DSN = 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN';
    process.env.SENTRY_ENV = 'production';
    // Bad: PLUGGY_ENV is sandbox
    process.env.PLUGGY_ENV = 'sandbox';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.TURNSTILE_SITE_KEY = 'prod-site-key';
    process.env.TURNSTILE_SECRET_KEY = 'prod-secret-key';
    process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY = 'prod-public-site-key';
    (process.env as Record<string, string>).NODE_ENV = 'production';

    await expect(import('@/lib/env')).rejects.toThrow(/OPS-04/);
  });
});
