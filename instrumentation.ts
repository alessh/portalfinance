/**
 * Next.js 16 instrumentation hook — runs once per runtime before any
 * request is served.
 *
 * Plan 01-04 — OPS-04 / OPS-01.
 *
 * IMPORT ORDER IS CRITICAL (RESEARCH.md Pitfall 7):
 *   1. `@/lib/env` FIRST — the Zod parse throws synchronously if any
 *      OPS-04 violation is detected (sandbox creds in production, bad
 *      Sentry DSN, etc.). This must fire before any other side-effect.
 *   2. Sentry runtime configs loaded by NEXT_RUNTIME.
 *
 * Do NOT reorder these imports or add new imports before @/lib/env.
 */
export async function register() {
  // Pitfall 7 — env import MUST be first to trigger OPS-04 guard before
  // any other side-effect loads (sentry, logger, db, etc.).
  await import('@/lib/env');

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
