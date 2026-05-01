// SERVER-ONLY. Client code must read process.env.NEXT_PUBLIC_* directly.
// This module must NOT be imported from the browser bundle — all values here
// are server-side secrets. Client components that need a public key read
// process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY directly at call site.

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

    // Public origin used when generating absolute URLs in transactional
    // emails (password-reset link, account-unlock link, etc.). Defaults
    // to localhost for dev/tests; the OPS-04 refine below requires
    // https + non-localhost in production.
    NEXTAUTH_URL: z.string().url().default('http://localhost:3000'),

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

    // AWS SES credentials.
    //
    // Plan 01.1-02 / SEC-02 + Plan 01.1-03 Recommendation 1 --
    // AWS access keys are OPTIONAL in every environment, including
    // production. The AWS SDK default credential provider chain
    // (used by src/mailer.ts) falls through to the IAM task role
    // attached to the Copilot Fargate service when these env vars
    // are absent. Local dev + tests can still set them via
    // AWS_PROFILE or explicit env. If neither env creds nor a task
    // role are available, the SDK fails fast on the first SendEmail
    // call (CredentialsProviderError) -- fail-closed, not silent.
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_REGION: z.string().default('sa-east-1'),
    SES_FROM_EMAIL: z.string().email().default('no-reply@portalfinance.app'),

    // Cloudflare Turnstile — server-side secret + client-exposed site key.
    // Optional in tests; required in production (OPS-04 refine enforces).
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),
    NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY: z.string().optional(),

    // Structured logging
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    // Plan 01.1-02 / D-11 -- the migrate Scheduled Job is a third
    // SERVICE_NAME alongside web + worker. Copilot manifests in
    // Plan 01.1-04 set this explicitly; local dev defaults to 'web'.
    SERVICE_NAME: z.enum(['web', 'worker', 'migrate']).default('web'),
  })
  .refine(
    (e) => {
      if (e.NODE_ENV !== 'production') return true;
      // Skip OPS-04 runtime guards during `next build` (NEXT_PHASE is set by
      // Next.js during the build step). The guard fires when the server
      // actually boots to serve traffic, which is the correct enforcement point.
      if (process.env.NEXT_PHASE === 'phase-production-build') return true;

      // OPS-04: in production, Sentry DSN MUST target the EU data plane
      // (de.sentry.io or *.ingest.de.sentry.io). A US ingest DSN such as
      // oNNNN.ingest.sentry.io would satisfy \.sentry\.io$ but violates LGPD
      // data-residency requirements. The regex requires `.de.sentry.io` suffix.
      if (e.SENTRY_DSN) {
        try {
          const hostname = new URL(e.SENTRY_DSN).hostname;
          if (!/\.de\.sentry\.io$/.test(hostname)) return false;
        } catch {
          return false;
        }
      }

      // OPS-04: SENTRY_ENV must be 'production' when NODE_ENV is 'production'.
      if (e.SENTRY_ENV !== 'production') return false;

      // OPS-04: NEXTAUTH_URL must be https + non-localhost in production.
      // Email links (password reset, account unlock) embed this origin;
      // an http or localhost value silently breaks every transactional
      // email and is a clear deployment misconfig.
      try {
        const u = new URL(e.NEXTAUTH_URL);
        if (u.protocol !== 'https:') return false;
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return false;
      } catch {
        return false;
      }

      // OPS-04: No sandbox credentials in production.
      if (e.PLUGGY_ENV !== undefined && e.PLUGGY_ENV !== 'production') return false;
      if (e.ASAAS_ENV !== undefined && e.ASAAS_ENV !== 'production') return false;

      return true;
    },
    {
      message:
        'OPS-04 violation: production NODE_ENV with sandbox credentials or non-prod Sentry',
    },
  )
  // Plan 01.1-02 / SEC-02 -- AWS access keys are NO LONGER required
  // in production. Production runs on Copilot Fargate with an IAM task
  // role attached to the service; the SDK default credential provider
  // chain picks up the task-role STS session. Removing the prod refine
  // unblocks Plan 01.1-03 Task 3 (SES IAM task-role pivot).
  .refine(
    (e) => {
      if (e.NODE_ENV !== 'production') return true;
      if (process.env.NEXT_PHASE === 'phase-production-build') return true;
      // Plan 01.1-02 / D-11 -- only the `web` service renders signup
      // forms, so only `web` requires the TURNSTILE_* keys. The
      // `worker` (pg-boss consumers) and `migrate` (one-shot Drizzle
      // migrator) services neither render forms nor verify Turnstile
      // tokens, so they skip this gate. The OPS-04 sandbox-in-prod
      // guard above still fires for ALL services regardless.
      if (e.SERVICE_NAME !== 'web') return true;
      // Cloudflare Turnstile keys are required in production for web only.
      return !!(e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY && e.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY);
    },
    {
      message: 'OPS-04 violation: TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, and NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY are required in production',
    },
  );

export const env = EnvSchema.parse(process.env);

export type Env = z.infer<typeof EnvSchema>;
