/**
 * Next.js 16 instrumentation hook — runs once per runtime before any
 * request is served.
 *
 * Plan 01-04 — OPS-04 / OPS-01.
 *
 * Location note: this project uses the `src/` directory layout, so this
 * file MUST live at `src/instrumentation.ts` (next to `src/app/`). Placing
 * it at the project root is silently ignored by Next 15/16, which causes
 * `Sentry.init()` to never run in production — every error gets dropped
 * client-side. Discovered during Phase 01 HUMAN-UAT Test 2.
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
  await import('@/lib/env');

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
