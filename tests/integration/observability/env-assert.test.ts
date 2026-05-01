/**
 * OPS-04 boot assertion integration test.
 *
 * Plan 01-04 — T-ENV-MISMATCH mitigation (subprocess validation).
 * RESEARCH.md § Plan slice 01-04 item 5.
 *
 * Spawns a subprocess that imports @/lib/env with a production + sandbox
 * combination, asserts subprocess exits non-zero and stderr contains
 * 'OPS-04 violation'.
 *
 * Uses spawnSync from child_process — no async complexity.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const RUNNER = resolve(REPO_ROOT, 'tests/fixtures/env-runner/env-runner.ts');

// tsx main entry point (JS) — works cross-platform without .bin symlink issues.
const TSX_MAIN = resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

function goodProductionEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://x:y@db.example.com:5432/prod',
    NEXTAUTH_SECRET: 'production-secret-at-least-32-chars-xxxxxxxxx',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    CPF_HASH_PEPPER: 'production-pepper-at-least-32-chars-xx',
    SENTRY_DSN: 'https://abc@oNNNN.ingest.de.sentry.io/PNNNN',
    SENTRY_ENV: 'production',
    NEXTAUTH_URL: 'https://portalfinance.app',
    AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    TURNSTILE_SITE_KEY: 'prod-site-key',
    TURNSTILE_SECRET_KEY: 'prod-secret-key',
    NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY: 'prod-public-key',
  };
}

function runEnvRunner(envOverrides: Record<string, string>) {
  // Clear parent env; provide only what we want the subprocess to see.
  // Inherit most of the parent environment but override the app-specific vars.
  // This ensures tsx, Node.js, and OS utilities resolve correctly on all
  // platforms (Windows, Linux) without hardcoding paths.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Override only the app-specific env vars for the test scenario.
    ...envOverrides,
    // Ensure NEXT_PHASE is not set — otherwise the build-time bypass would
    // suppress OPS-04 guards and these tests would never catch violations.
    NEXT_PHASE: undefined,
  };

  return spawnSync(
    process.execPath, // Use the current Node.js binary — always available.
    [TSX_MAIN, RUNNER],
    {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

describe('OPS-04 boot assertion (subprocess)', () => {
  it('exits non-zero and writes OPS-04 violation to stderr when NODE_ENV=production with PLUGGY_ENV=sandbox', () => {
    const result = runEnvRunner({
      ...goodProductionEnv(),
      PLUGGY_ENV: 'sandbox',
    });

    expect(result.status).not.toBe(0);
    const stderr = result.stderr ?? '';
    expect(stderr).toContain('OPS-04 violation');
  });

  it('exits non-zero and writes OPS-04 violation when NODE_ENV=production with SENTRY_ENV=staging', () => {
    const result = runEnvRunner({
      ...goodProductionEnv(),
      SENTRY_ENV: 'staging',
    });

    expect(result.status).not.toBe(0);
    const stderr = result.stderr ?? '';
    expect(stderr).toContain('OPS-04 violation');
  });

  it('exits 0 for a valid production env (good path)', () => {
    const result = runEnvRunner(goodProductionEnv());

    // If this fails it means our "good" env is actually bad — fix the fixture.
    expect(result.status).toBe(0);
  });
});
