---
phase: 01-foundation-identity
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 52
files_reviewed_list:
  - README.md
  - docs/legal/privacy-v1.md
  - docs/legal/terms-v1.md
  - docs/ops/encryption-key-rotation.md
  - docs/ops/ses-production-access.md
  - instrumentation-client.ts
  - instrumentation.ts
  - sentry.client.config.ts
  - sentry.edge.config.ts
  - sentry.server.config.ts
  - src/app/api/privacy/delete/route.ts
  - src/app/api/privacy/export/route.ts
  - src/app/api/webhooks/ses/bounces/route.ts
  - src/app/dashboard/page.tsx
  - src/app/settings/privacy/page.tsx
  - src/components/banners/EmailVerificationNagBanner.tsx
  - src/components/consent/ConsentScreen.tsx
  - src/components/demo/DemoDashboard.tsx
  - src/components/settings/ConfirmDestructiveModal.tsx
  - src/components/settings/DSRRequestCard.tsx
  - src/components/settings/RequestPendingState.tsx
  - src/emails/AccountUnlock.tsx
  - src/emails/DSRAcknowledgment.tsx
  - src/emails/PasswordReset.tsx
  - src/jobs/boss.ts
  - src/jobs/worker.ts
  - src/jobs/workers/accountUnlockEmailWorker.ts
  - src/jobs/workers/dsrAcknowledgeWorker.ts
  - src/jobs/workers/passwordResetEmailWorker.ts
  - src/jobs/workers/sesBounceWorker.ts
  - src/lib/auditLog.ts
  - src/lib/consentScopes.ts
  - src/lib/consentVersions.ts
  - src/lib/demoData.ts
  - src/lib/env.ts
  - src/lib/formatCurrency.ts
  - src/lib/logger.edge.ts
  - src/lib/logger.ts
  - src/lib/mailer.ts
  - src/lib/piiScrubber.ts
  - src/lib/sentry.ts
  - src/lib/session.ts
  - src/lib/snsVerifier.ts
  - tests/fixtures/env-runner/env-runner.ts
  - tests/fixtures/sns-fixtures.ts
  - tests/integration/lgpd/consent.test.ts
  - tests/integration/lgpd/dsr.test.ts
  - tests/integration/observability/env-assert.test.ts
  - tests/integration/webhooks/ses-bounce.test.ts
  - tests/unit/components/ConsentScreen.test.tsx
  - tests/unit/lib/logger.test.ts
  - tests/unit/lib/pii-scrubber.test.ts
  - tests/unit/observability/sentry-scrubber.test.ts
findings:
  critical: 3
  warning: 5
  info: 4
  total: 12
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 52
**Status:** issues_found

## Summary

This review covers Waves 3–4 of Phase 1: the LGPD scaffolding (consent,
DSR routes, PII scrubber, audit log) and the observability close-out (Sentry
EU config, pino logger, SES bounce webhook, demo dashboard, pg-boss workers).

Overall quality is high. The PII scrubbing pipeline is thorough and covers
all load-time paths. The Sentry `beforeSend` correctly delegates to
`scrubObject`/`scrubString` with no duplicate logic. The `instrumentation.ts`
boot order is correct — `@/lib/env` is first. The webhook handler enforces
signature verification before any DB work, achieves sub-200 ms response, and
is idempotent at both the handler and worker levels.

Three critical findings require fixes before this phase ships:

1. **OPS-04 DSN check allows non-EU Sentry** — the regex in `env.ts` only
   requires `*.sentry.io`, not specifically `*.de.sentry.io`, meaning a US
   Sentry DSN passes the production gate despite the data-residency requirement.
2. **PII leak via `console.warn` in `mailer.ts`** — the dev-mode fallback
   logs the raw recipient email address, bypassing the structured logger and
   its scrubbing hook.
3. **Hardcoded dummy Turnstile token in `DSRRequestCard.tsx`** — the delete
   flow ships a literal placeholder token that the API accepts only because
   `verifyTurnstile` is expected to be wired. If Turnstile verification is
   ever soft-failed or the key is absent, the guard is silently bypassed
   with no visible warning to the developer.

---

## Critical Issues

### CR-01: OPS-04 Sentry DSN check does not enforce EU data plane

**File:** `src/lib/env.ts:86`

**Issue:** The production refine validates that the Sentry DSN hostname ends
with `.sentry.io`, but the project requirement (CLAUDE.md, README.md) is
`de.sentry.io` (EU data plane for Brazilian data residency). A US ingest DSN
such as `https://abc@oNNNN.ingest.sentry.io/NNN` passes the gate because
`ingest.sentry.io` satisfies the regex. Ironically, the test fixture in
`env-assert.test.ts:31` uses `oNNNN.ingest.de.sentry.io`, so the test never
exercises the incorrect code path.

**Fix:**
```typescript
// src/lib/env.ts line ~86 — tighten the hostname check
if (e.SENTRY_DSN) {
  try {
    const hostname = new URL(e.SENTRY_DSN).hostname;
    // Require the EU data plane: *.de.sentry.io or *.ingest.de.sentry.io
    if (!/\.de\.sentry\.io$/.test(hostname)) return false;
  } catch {
    return false;
  }
}
```

---

### CR-02: Raw email address leaked to console in mailer dev-mode fallback

**File:** `src/lib/mailer.ts:92-97`

**Issue:** When AWS credentials are absent (development and CI), `sendEmail`
logs a `console.warn` that includes the raw recipient email address (`to_lower`)
and the email subject. This bypasses the pino structured logger and its
`scrubObject` hook, so the email address is emitted in plaintext to stdout/stderr.
In a CI environment whose logs are captured by a third-party service (Sentry log
drain, Railway log shipping), this constitutes a PII leak.

**Fix:** Replace `console.warn` with the structured logger and scrub the address.
```typescript
import { logger } from '@/lib/logger';

// replace lines 92-97:
logger.warn(
  { event: 'mailer_no_credentials', email_lower: '[EMAIL REDACTED IN DEV]' },
  '[mailer] AWS credentials not set — skipping send',
);
```
If a developer genuinely needs to see the destination during local development,
use `logger.debug` with an explicit note that the value is scrubbed in non-test
environments.

---

### CR-03: Hardcoded dummy Turnstile token in DSRRequestCard delete flow

**File:** `src/components/settings/DSRRequestCard.tsx:139`

**Issue:** The `onConfirm` callback for the delete modal passes the literal
string `'dummy-turnstile-token-for-phase1'` to `submitDelete`. The server-side
`POST /api/privacy/delete` passes this token to `verifyTurnstile`, which in
production will reject it (returning `false`), resulting in a 400. However:

1. During local development, if `TURNSTILE_SECRET_KEY` is missing or the
   verifier is lenient, the guard silently passes.
2. Any developer who reads this code could infer the deletion endpoint's
   Turnstile requirement and craft a request with a known dummy value.
3. The client-side `ConfirmDestructiveModal` accepts a `confirmPhrase`
   (`EXCLUIR`) that enforces user intent in the browser, but the server only
   enforces Turnstile — the type-in phrase is purely a UI affordance with no
   server-side check (the `BodySchema` at the route only validates
   `confirm_phrase: z.literal('EXCLUIR')`, which the client hard-codes in
   `submitDelete`).

The placeholder is described as "for phase1", but it must not reach production.
If Phase 2 does not replace it, the delete flow will return 400 for every real
user attempting deletion.

**Fix:** Add a `TODO(phase2)` comment and add a runtime assertion:
```typescript
// src/components/settings/DSRRequestCard.tsx
// Replace line 139:
onConfirm={() => {
  // TODO(phase2): replace with real Turnstile widget token from @marsidev/react-turnstile
  // Passing a dummy token here will cause 400 from the server in production.
  // This is intentional Phase 1 scaffolding — Phase 2 wires the real widget.
  void submitDelete('dummy-turnstile-token-for-phase1');
}}
```
Optionally, add a `process.env.NODE_ENV === 'production'` guard inside
`submitDelete` that throws before sending the dummy token:
```typescript
async function submitDelete(turnstile_token: string) {
  if (process.env.NODE_ENV === 'production' && turnstile_token.startsWith('dummy-')) {
    setError('Verificação anti-bot não configurada. Contate o suporte.');
    return;
  }
  // ... rest of function
}
```

---

## Warnings

### WR-01: dsrAcknowledgeWorker fetches DSR row without user_id filter

**File:** `src/jobs/workers/dsrAcknowledgeWorker.ts:37-41`

**Issue:** The worker queries `dsr_requests` by `id` alone:
```typescript
const [req] = await db
  .select()
  .from(dsr_requests)
  .where(eq(dsr_requests.id, job.data.dsr_request_id));
```
This is not a direct IDOR risk because `job.data.dsr_request_id` comes from
`pgboss.job`, which is only written by the API route after a `requireSession()`
check. However, the IDOR guard convention (P26) requires `AND user_id = $userId`
on every query that reads user-scoped data. The `DsrAcknowledgePayload` includes
`user_email`, which means the worker already has the user identifier — it simply
does not verify that the fetched DSR row belongs to that user. A compromised
job payload (e.g., via a pg-boss admin bypass) could trigger an acknowledgment
email for a different user's DSR row.

**Fix:** Add a `user_id` filter derived from a separate users lookup, or pass
`user_id` in the job payload and filter by it:
```typescript
// Extend payload to include user_id (already available at enqueue time)
export interface DsrAcknowledgePayload {
  dsr_request_id: string;
  user_email: string;
  user_id: string; // add this
}

// In the worker query:
const [req] = await db
  .select()
  .from(dsr_requests)
  .where(
    and(
      eq(dsr_requests.id, job.data.dsr_request_id),
      eq(dsr_requests.user_id, job.data.user_id),  // IDOR guard
    ),
  );
```

---

### WR-02: sesBounceWorker does not mark event as processed when recipients list is empty

**File:** `src/jobs/workers/sesBounceWorker.ts:79-111`

**Issue:** When `recipients` is an empty array (a valid SES notification with
no bounced addresses, e.g., a soft-bounce envelope with zero recipients), the
`for` loop body never executes, and `processed_at` is never set. If the worker
is replayed, the `if (ev.processed_at)` guard at line 53 will not skip it
because `processed_at` is still `null`. The event will be reprocessed on every
replay — a violation of the T-WH-REPLAY idempotency invariant.

**Fix:** Move the `processed_at` update outside the `for` loop so it fires
unconditionally after the loop completes:
```typescript
// After the for...of loop, unconditionally mark processed:
await db
  .update(webhook_events)
  .set({ processed_at: new Date() })
  .where(eq(webhook_events.id, ev.id));
```
The current code inside the loop is correct for the happy path but the update
should not be conditional on there being at least one recipient.

---

### WR-03: Worker error handling silently drops failed individual jobs

**File:** `src/jobs/workers/dsrAcknowledgeWorker.ts:33-73`,
`src/jobs/workers/sesBounceWorker.ts:38-112`,
`src/jobs/workers/passwordResetEmailWorker.ts:18-31`,
`src/jobs/workers/accountUnlockEmailWorker.ts:18-31`

**Issue:** All four workers use `for...of` over a batch of jobs without
try/catch around the per-job body. If `sendEmail` or a DB call throws for
one job in a batch of N, the exception propagates out of the worker function,
pg-boss marks the entire batch as failed, and ALL N jobs are retried — including
the jobs that succeeded. This causes duplicate emails and duplicate
`ses_suppressions` writes (mitigated by `onConflictDoUpdate`, but not for
duplicate DSR acknowledgments which use audit_log insertions).

**Fix:** Wrap each job's processing in a try/catch:
```typescript
for (const job of jobs) {
  try {
    // ... existing job logic
  } catch (err) {
    logger.error(
      { event: 'worker_job_failed', job_id: job.id, error: String(err) },
      'Job processing failed — pg-boss will retry this job individually',
    );
    // Re-throw to let pg-boss mark THIS job as failed (not the whole batch).
    // With pg-boss localConcurrency > 1, individual job failure isolation
    // requires throwing; batch workers share the fail signal.
    throw err;
  }
}
```
Alternatively, configure pg-boss `work()` with `batchSize: 1` for workers
that must not have cross-job failure propagation.

---

### WR-04: `consentVersions.ts` falls back to `'fallback000000'` silently in production

**File:** `src/lib/consentVersions.ts:37-39`

**Issue:** When `docs/legal/terms-v1.md` or `docs/legal/privacy-v1.md` cannot
be read (the `catch` block), `short_sha` returns `'fallback000000'`, so
`versions.ACCOUNT_CREATION` becomes `v1.0.0+terms.fallback000000+privacy.fallback000000`.
This value will be written to `user_consents.consent_version` for every user
who signs up in any environment where the docs are not co-located with the
running process — including Docker images that `COPY` only the `src/` and
`public/` directories (the `docs/` directory may not be present).

If the fallback value is stored for real users, Phase 6's stale-consent
detection will incorrectly match the fallback as a valid version, or will
always flag those users for re-consent (depending on which direction the
comparison goes).

The comment acknowledges this but the mitigation ("Phase 6 gate enforces
the real hash") is not yet in place.

**Fix:** Add an OPS-04-style production guard:
```typescript
function short_sha(file_path: string): string {
  try {
    const content = readFileSync(resolve(process.cwd(), file_path), 'utf8');
    return createHash('sha256').update(content).digest('hex').slice(0, 12);
  } catch {
    if (process.env.NODE_ENV === 'production' &&
        process.env.NEXT_PHASE !== 'phase-production-build') {
      throw new Error(
        `OPS-04 violation: consent document not found at ${file_path}. ` +
        `Ensure docs/ is included in the production Docker image.`,
      );
    }
    return 'fallback000000';
  }
}
```

---

### WR-05: `sentry.server.config.ts` enabled in development (no `NODE_ENV` guard)

**File:** `sentry.server.config.ts:21`

**Issue:** The server and edge Sentry configs use:
```typescript
enabled: process.env.NODE_ENV !== 'test',
```
This means Sentry is active in development when `SENTRY_DSN` is set, which
will ship development error events (including stack traces with local file
paths) to Sentry EU. The client config at `sentry.client.config.ts:47`
correctly excludes both `development` and `test`:
```typescript
enabled: process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test',
```
The server/edge configs are inconsistent with the client convention.

**Fix:** Apply the same guard to server and edge configs:
```typescript
// sentry.server.config.ts and sentry.edge.config.ts
enabled: process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test',
```

---

## Info

### IN-01: `DSRRequestCard.tsx` — export route has no Turnstile and no rate limit, documented as TODO

**File:** `src/app/api/privacy/export/route.ts:13-14`

**Issue:** The export route is intentionally unprotected by Turnstile and
has a `TODO Plan 01-04 extension` for rate limiting. An authenticated user
can call this endpoint in a loop to flood `dsr_requests` with EXPORT rows
and trigger unlimited DSR acknowledgment emails. In Phase 1 this is acceptable
(SES is not provisioned), but the TODO should be tracked with a phase tag.

**Fix:** Add `// TODO(phase4): add rate limit — max 1 EXPORT request per user per 30 days` comment and open a tracking issue for Phase 4.

---

### IN-02: `ConsentScreen.test.tsx` — Test 12 contains a non-asserting soft fallback

**File:** `tests/unit/components/ConsentScreen.test.tsx:136-148`

**Issue:** Test 12 includes a branch where the button remains disabled after
the click simulation, and the test "passes" via `expect(true).toBe(true)`.
This means the test does not actually verify that `onConsent` is called — it
documents a known limitation of the React 19 + happy-dom combination but does
so with a vacuously true assertion. If `handleConsent` were broken (e.g.,
someone removed the `onConsent(new Date())` call), this test would still pass.

**Fix:** At minimum, add a comment referencing a tracking ticket. Better,
add a direct invocation of `handleConsent` via a ref or a test-only data
attribute to verify the callback fires regardless of the DOM simulation
limitation.

---

### IN-03: `dsrAcknowledgeWorker.ts` uses `console.warn` instead of structured logger

**File:** `src/jobs/workers/dsrAcknowledgeWorker.ts:45`

**Issue:** The "DSR row not found" warning uses `console.warn` rather than
the `logger` from `@/lib/logger`. This means the warning is not structured
JSON and will not be captured correctly by Railway's log aggregator (which
parses pino JSON). It is also inconsistent with `sesBounceWorker` which
correctly uses `logger.warn`.

**Fix:**
```typescript
// Add import at top of file:
import { logger } from '@/lib/logger';

// Replace line 45:
logger.warn(
  { event: 'dsr_worker_row_not_found', dsr_request_id: job.data.dsr_request_id },
  'DSR row not found — skipping',
);
```

---

### IN-04: `boss.ts` pg-boss error handler uses `console.error` instead of structured logger

**File:** `src/jobs/boss.ts:81`

**Issue:** The pg-boss error event handler uses `console.error('[pg-boss] error', err)`.
This is the same structural inconsistency as IN-03 — unstructured output that
Railway's JSON log parser will not index correctly. The `worker.ts` entrypoint
imports `logger` but `boss.ts` does not.

**Fix:**
```typescript
// boss.ts — add import at top:
import { logger } from '@/lib/logger';

// Replace line 81:
_boss.on('error', (err: Error) => {
  logger.error({ event: 'pgboss_error', error: String(err) }, 'pg-boss error');
});
```

---

_Reviewed: 2026-04-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
