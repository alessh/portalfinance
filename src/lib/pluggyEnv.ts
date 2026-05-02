/**
 * Typed Pluggy credential reader — sandbox vs production selection.
 *
 * Plan 02-02 — D-40 (credential isolation by env label).
 *
 * Production refine in env.ts (plan 02-01) already ensures that in
 * NODE_ENV=production the non-sandbox values are present. These helpers
 * throw loudly when production creds are required but missing, so the
 * service fails fast on cold start rather than silently using stub values.
 *
 * NEVER log the return values of getPluggyClientId() or
 * getPluggyClientSecret() — they are API secrets.
 */
import { env } from '@/lib/env';

export function getPluggyEnvLabel(): 'sandbox' | 'production' {
  return env.PLUGGY_ENV ?? 'sandbox';
}

export function getPluggyClientId(): string {
  if (getPluggyEnvLabel() === 'production') {
    if (!env.PLUGGY_CLIENT_ID)
      throw new Error(
        'PLUGGY_CLIENT_ID is required when PLUGGY_ENV=production (D-40). ' +
        'Set it in the production environment (AWS SSM SecureString).',
      );
    return env.PLUGGY_CLIENT_ID;
  }
  // Sandbox: prefer PLUGGY_SANDBOX_CLIENT_ID; fall back to PLUGGY_CLIENT_ID; then empty string.
  return env.PLUGGY_SANDBOX_CLIENT_ID ?? env.PLUGGY_CLIENT_ID ?? '';
}

export function getPluggyClientSecret(): string {
  if (getPluggyEnvLabel() === 'production') {
    if (!env.PLUGGY_CLIENT_SECRET)
      throw new Error(
        'PLUGGY_CLIENT_SECRET is required when PLUGGY_ENV=production (D-40). ' +
        'Set it in the production environment (AWS SSM SecureString).',
      );
    return env.PLUGGY_CLIENT_SECRET;
  }
  // Sandbox: prefer PLUGGY_SANDBOX_CLIENT_SECRET; fall back; then empty string.
  return env.PLUGGY_SANDBOX_CLIENT_SECRET ?? env.PLUGGY_CLIENT_SECRET ?? '';
}
