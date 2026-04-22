/**
 * Sentry browser/client-side configuration.
 *
 * Plan 01-04 — OPS-01.
 *
 * NOTE: `lib/env.ts` is SERVER-ONLY and must NOT be imported here.
 * Client bundles only have access to NEXT_PUBLIC_* env vars.
 * The DSN is passed directly from process.env — Next.js replaces this at
 * build time, but SENTRY_DSN is server-only so it evaluates to undefined
 * in the client bundle. The Sentry client will be configured via the
 * instrumentation-client.ts approach for DSN injection.
 *
 * PII scrubbing on the client: The browser beforeSend reuses the same
 * piiScrubber utility. node:crypto is NOT used (no hashUserIdForSentry on
 * the client — user.id is dropped entirely instead).
 */
import * as Sentry from '@sentry/nextjs';
import { scrubString, scrubObject } from '@/lib/piiScrubber';
import type { Event } from '@sentry/types';

function clientBeforeSend(event: Event): Event | null {
  try {
    if (event.message) event.message = scrubString(event.message);
    if (event.exception?.values) {
      event.exception.values = event.exception.values.map((ex) => {
        if (ex.value) ex.value = scrubString(ex.value);
        return ex;
      });
    }
    if (event.extra) event.extra = scrubObject(event.extra) as typeof event.extra;
    if (event.contexts) event.contexts = scrubObject(event.contexts) as typeof event.contexts;
    // On the client, drop user object entirely to avoid leaking session details.
    if (event.user) event.user = undefined;
  } catch {
    // NEVER throw from beforeSend.
  }
  return event;
}

Sentry.init({
  // SENTRY_DSN is injected server-side; client receives it via NEXT_PUBLIC_SENTRY_DSN
  // if configured. For Phase 1, the client Sentry init is a no-op unless
  // NEXT_PUBLIC_SENTRY_DSN is explicitly set.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend: clientBeforeSend,
  enabled: process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test',
});
