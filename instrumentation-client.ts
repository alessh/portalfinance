/**
 * Next.js 16 client-side instrumentation.
 *
 * Plan 01-04 — OPS-01.
 *
 * Loaded by the browser bundle before the app renders. Initialises Sentry
 * for the client runtime (see sentry.client.config.ts for the init config).
 *
 * Per @sentry/nextjs@10 conventions, this file is the canonical client-init
 * entry point for Next.js 16+ App Router. The `sentry.client.config.ts` file
 * at repo root is imported here so it runs at exactly the right time.
 */
import './sentry.client.config';
