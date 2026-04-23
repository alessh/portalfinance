/**
 * Sentry edge-runtime configuration.
 *
 * Plan 01-04 — OPS-01. Loaded by instrumentation.ts when
 * NEXT_RUNTIME === 'edge'.
 *
 * Edge runtime does NOT have access to node:crypto, so
 * hashUserIdForSentry is not used. User objects are dropped entirely.
 * The scrubString / scrubObject utilities are safe on edge (no node APIs).
 *
 * NOTE: lib/env.ts is imported from instrumentation.ts BEFORE this file —
 * the OPS-04 guard fires first (RESEARCH.md Pitfall 7).
 */
import * as Sentry from '@sentry/nextjs';
import { beforeSend } from '@/lib/sentry';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENV,
  tracesSampleRate: 0.1,
  beforeSend,
  // Exclude development and test environments — matches the client config
  // convention. Prevents local stack traces with file paths leaking to Sentry EU.
  enabled: process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test',
});
