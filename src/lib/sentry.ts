/**
 * Shared Sentry utilities — PII-scrubbing beforeSend + user-ID hasher.
 *
 * Plan 01-04 — OPS-01 / LGPD-06.
 *
 * IMPORTANT — beforeSend MUST be synchronous. Sentry swallows async
 * beforeSend callbacks and ships unscrubbed events (RESEARCH.md Pitfall 5).
 * Any async-looking cleanup or fetch MUST NOT be added here.
 *
 * hashUserIdForSentry: uses node:crypto which is only available on the Node
 * runtime. On the edge runtime (middleware), user.id is set to `undefined`
 * rather than hashed — edge middleware typically runs before user context is
 * attached anyway.
 */
import type { Event } from '@sentry/types';
import { scrubString, scrubObject } from '@/lib/piiScrubber';

// ---------------------------------------------------------------------------
// User-ID hasher (Node runtime only)
// ---------------------------------------------------------------------------

/**
 * Hash a user ID with a server-side secret so Sentry receives a
 * deterministic-but-private token. The NEXTAUTH_SECRET prevents cross-
 * project correlation even if two organizations use the same user IDs.
 *
 * Falls back to undefined on edge (no node:crypto available).
 */
export function hashUserIdForSentry(user_id: string): string | undefined {
  // Guard: node:crypto is not available in the edge runtime.
  if (typeof process === 'undefined' || !process.versions?.node) {
    return undefined;
  }
  try {
    // Lazy import to avoid bundling node:crypto in the browser.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require('node:crypto');
    const secret = process.env.NEXTAUTH_SECRET ?? '';
    return createHash('sha256')
      .update(secret)
      .update(user_id)
      .digest('hex')
      .slice(0, 16);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// beforeSend
// ---------------------------------------------------------------------------

/**
 * Sentry beforeSend callback — synchronously scrubs PII from every event
 * before it leaves the process.
 *
 * Covered by tests/unit/observability/sentry-scrubber.test.ts (5 cases).
 *
 * Never throws — any internal error is silently caught and the (possibly
 * partially-scrubbed) event is still returned so Sentry receives something
 * rather than nothing. Callers cannot rely on full scrubbing if this
 * function throws, but the catch block prevents double-faulting.
 */
export function beforeSend(event: Event): Event | null {
  try {
    // --- Scrub top-level message ---
    if (event.message) {
      event.message = scrubString(event.message);
    }

    // --- Scrub exception values ---
    if (event.exception?.values) {
      event.exception.values = event.exception.values.map((ex) => {
        if (ex.value) ex.value = scrubString(ex.value);
        return ex;
      });
    }

    // --- Scrub breadcrumbs ---
    if (event.breadcrumbs) {
      const values = Array.isArray(event.breadcrumbs)
        ? event.breadcrumbs
        : (event.breadcrumbs as { values?: unknown[] }).values ?? [];
      const scrubbed = (values as Array<{ message?: string }>).map((bc) => {
        if (bc.message) bc.message = scrubString(bc.message);
        return bc;
      });
      if (Array.isArray(event.breadcrumbs)) {
        event.breadcrumbs = scrubbed as typeof event.breadcrumbs;
      } else {
        (event.breadcrumbs as { values?: unknown[] }).values = scrubbed;
      }
    }

    // --- Scrub extra context ---
    if (event.extra) {
      event.extra = scrubObject(event.extra) as typeof event.extra;
    }

    // --- Scrub contexts ---
    if (event.contexts) {
      event.contexts = scrubObject(event.contexts) as typeof event.contexts;
    }

    // --- Scrub / hash user ---
    if (event.user) {
      const raw_id = event.user.id;
      if (raw_id) {
        const hashed = hashUserIdForSentry(String(raw_id));
        // Replace user entirely: only expose the hashed ID, drop email/ip/username.
        event.user = hashed ? { id: hashed } : {};
      } else {
        // Drop any email / ip leakage even when no id is present.
        event.user = undefined;
      }
    }
  } catch {
    // NEVER throw from beforeSend per Sentry contract (RESEARCH.md Pitfall 5).
  }

  return event;
}
