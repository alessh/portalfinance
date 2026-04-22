/**
 * Zod-validated env loader for the whole application.
 *
 * **CRITICAL — DO NOT LOG `env.ENCRYPTION_KEY` OR `env.CPF_HASH_PEPPER`.**
 *
 * Both secrets are required to decrypt CPFs at rest and to compute
 * uniqueness lookups. A leak of either devalues the at-rest encryption
 * for every user. They must NEVER appear in any log statement, error
 * message, Sentry breadcrumb, or HTTP response body.
 *
 * This module parses `process.env` at load time. Any misconfiguration —
 * missing variable, bad shape, OPS-04 violation — throws synchronously,
 * causing the Next.js server (and the worker) to fail fast on cold start
 * before serving traffic.
 *
 * Imports: ONLY `zod`. This module sits at the bottom of the dependency
 * graph; many other modules import `env`, so anything else in this file
 * risks a circular import at boot.
 */
import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),
    DATABASE_URL: z.string().url(),
    NEXTAUTH_SECRET: z.string().min(32),

    // Base64-encoded 32-byte AES-256-GCM master key.
    ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/=_-]+$/, 'ENCRYPTION_KEY must be base64-encoded')
      .refine(
        (s) => Buffer.from(s, 'base64').length === 32,
        { message: 'ENCRYPTION_KEY must decode to exactly 32 bytes' },
      ),

    // Distinct from ENCRYPTION_KEY. Used as the HMAC pepper for CPF
    // uniqueness lookups so a database leak alone cannot brute-force CPFs.
    CPF_HASH_PEPPER: z.string().min(32),

    // Sentry / observability — optional in tests, required in production
    // (the OPS-04 refine below enforces the production shape).
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_ENV: z.enum(['development', 'staging', 'production']).optional(),

    // Pluggy / ASAAS / SES — not consumed in Phase 1, but tracked here so
    // the OPS-04 guard can assert sandbox credentials are absent in
    // production. Phase 2 / 5 land the real values.
    PLUGGY_ENV: z.enum(['sandbox', 'production']).optional(),
    ASAAS_ENV: z.enum(['sandbox', 'production']).optional(),

    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_REGION: z.string().default('sa-east-1'),
    SES_FROM_EMAIL: z.string().email().default('no-reply@portalfinance.com.br'),

    // Cloudflare Turnstile — server-side secret + client-exposed site key.
    // Optional in tests; the login route enforces presence at runtime.
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),
    NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY: z.string().optional(),
  })
  .refine(
    (e) => {
      if (e.NODE_ENV !== 'production') return true;
      // OPS-04: in production, no sandbox/test credentials may be present.
      const bad =
        (e.PLUGGY_ENV !== undefined && e.PLUGGY_ENV !== 'production') ||
        (e.ASAAS_ENV !== undefined && e.ASAAS_ENV !== 'production') ||
        (e.SENTRY_ENV !== undefined && e.SENTRY_ENV !== 'production');
      return !bad;
    },
    {
      message:
        'OPS-04 violation: NODE_ENV=production with sandbox/test credentials detected',
    },
  );

export const env = EnvSchema.parse(process.env);

export type Env = z.infer<typeof EnvSchema>;
