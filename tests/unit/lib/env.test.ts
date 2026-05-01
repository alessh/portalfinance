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

// Plan 01.1-02 additions -- D-11 SERVICE_NAME=migrate widening
describe('OPS-04 refinement -- migrate job variant (D-11)', () => {
  beforeEach(async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('accepts NODE_ENV=production + SERVICE_NAME=migrate without TURNSTILE + AWS creds', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    process.env.SENTRY_DSN = 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN';
    process.env.SENTRY_ENV = 'production';
    process.env.SERVICE_NAME = 'migrate';
    process.env.NEXTAUTH_URL = 'https://portalfinance.app';
    // No TURNSTILE_*, no AWS_ACCESS_KEY_*  -- migrate does not need them.
    (process.env as Record<string, string>).NODE_ENV = 'production';

    const mod = await import('@/lib/env');
    expect(mod.env.SERVICE_NAME).toBe('migrate');
    expect(mod.env.AWS_REGION).toBe('sa-east-1');
  });

  it('still throws for SERVICE_NAME=web when TURNSTILE_SECRET_KEY missing', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    process.env.SENTRY_DSN = 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN';
    process.env.SENTRY_ENV = 'production';
    process.env.SERVICE_NAME = 'web';
    // No TURNSTILE_* set -- web path must still throw.
    (process.env as Record<string, string>).NODE_ENV = 'production';

    await expect(import('@/lib/env')).rejects.toThrow(/TURNSTILE/);
  });

  it('preserves OPS-04 Pluggy sandbox-in-prod throw regardless of SERVICE_NAME', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    process.env.SENTRY_DSN = 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN';
    process.env.SENTRY_ENV = 'production';
    process.env.PLUGGY_ENV = 'sandbox';
    process.env.SERVICE_NAME = 'migrate';
    (process.env as Record<string, string>).NODE_ENV = 'production';

    await expect(import('@/lib/env')).rejects.toThrow(/OPS-04/);
  });
});

// Plan 01.1-02 additions -- SEC-02 + Plan 01.1-03 prereq -- AWS creds optional in prod
describe('SEC-02 + Plan 01.1-03 prereq -- AWS creds optional in prod (IAM task-role pivot)', () => {
  beforeEach(async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('accepts SERVICE_NAME=web with no AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    process.env.SENTRY_DSN = 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN';
    process.env.SENTRY_ENV = 'production';
    process.env.SERVICE_NAME = 'web';
    process.env.TURNSTILE_SITE_KEY = 'prod-site-key';
    process.env.TURNSTILE_SECRET_KEY = 'prod-secret-key';
    process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY = 'prod-public-site-key';
    process.env.NEXTAUTH_URL = 'https://portalfinance.app';
    // AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY intentionally undefined --
    // production relies on the IAM task role attached by Copilot.
    (process.env as Record<string, string>).NODE_ENV = 'production';

    const mod = await import('@/lib/env');
    expect(mod.env.SERVICE_NAME).toBe('web');
    expect(mod.env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(mod.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('accepts SERVICE_NAME=worker with no AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY and no TURNSTILE_*', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'production-pepper-at-least-32-chars-xx';
    process.env.NEXTAUTH_SECRET = 'production-secret-at-least-32-chars-x';
    process.env.DATABASE_URL = 'postgres://x:y@db.example.com:5432/prod';
    process.env.SENTRY_DSN = 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN';
    process.env.SENTRY_ENV = 'production';
    process.env.SERVICE_NAME = 'worker';
    process.env.NEXTAUTH_URL = 'https://portalfinance.app';
    // Plan 01.1-05 -- worker does NOT render signup forms, so TURNSTILE_*
    // are not required. AWS_ACCESS_KEY_* also intentionally undefined.
    (process.env as Record<string, string>).NODE_ENV = 'production';

    const mod = await import('@/lib/env');
    expect(mod.env.SERVICE_NAME).toBe('worker');
    expect(mod.env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(mod.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(mod.env.TURNSTILE_SITE_KEY).toBeUndefined();
  });

  it('still accepts AWS creds when explicitly set (local dev path)', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    process.env.CPF_HASH_PEPPER = 'test-pepper-at-least-32-chars-long-xyz';
    process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-chars-long-xxx';
    process.env.DATABASE_URL = 'postgres://x:y@localhost:5432/db';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    // SERVICE_NAME left at default 'web'; NODE_ENV=development.
    (process.env as Record<string, string>).NODE_ENV = 'development';

    const mod = await import('@/lib/env');
    expect(mod.env.AWS_ACCESS_KEY_ID).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(mod.env.AWS_SECRET_ACCESS_KEY).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  });
});
