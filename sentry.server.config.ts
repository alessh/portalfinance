/**
 * Sentry server-side configuration — Node runtime.
 *
 * Plan 01-04 — OPS-01. Loaded by instrumentation.ts when
 * NEXT_RUNTIME === 'nodejs'.
 *
 * DSN hostname MUST end with de.sentry.io (EU data plane).
 * Enforced at boot by the OPS-04 refine in lib/env.ts.
 */
import * as Sentry from '@sentry/nextjs';
import { beforeSend } from '@/lib/sentry';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENV,
  tracesSampleRate: 0.1,
  // PII-scrubbing beforeSend — MUST be synchronous (RESEARCH.md Pitfall 5).
  beforeSend,
  // Exclude development and test environments — matches the client config
  // convention. Prevents local stack traces with file paths leaking to Sentry EU.
  enabled: process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test',
});
