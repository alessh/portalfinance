---
phase: 01-foundation-identity
fixed_at: 2026-04-22T21:41:00Z
review_path: .planning/phases/01-foundation-identity/01-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 7
skipped: 1
status: partial
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-04-22T21:41:00Z
**Source review:** `.planning/phases/01-foundation-identity/01-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (3 critical + 5 warnings)
- Fixed: 7
- Skipped: 1

**Typecheck:** `pnpm typecheck` — PASS (no errors)
**Unit tests:** `pnpm test:unit` — PASS (9 files, 45 tests)

---

## Fixed Issues

### CR-01: OPS-04 Sentry DSN check does not enforce EU data plane

**Files modified:** `src/lib/env.ts`
**Commit:** `07576d0`
**Applied fix:** Changed the production refine regex from `\.sentry\.io$` to `\.de\.sentry\.io$`. A US ingest DSN such as `oNNNN.ingest.sentry.io` now correctly fails the OPS-04 gate. Added comment clarifying the LGPD data-residency rationale.

---

### CR-02: Raw email address leaked to console in mailer dev-mode fallback

**Files modified:** `src/lib/mailer.ts`
**Commit:** `d31a548`
**Applied fix:** Replaced `console.warn` (which emitted raw `to_lower` and `params.subject`) with `logger.warn` using a literal `'[EMAIL REDACTED IN DEV]'` placeholder. The structured logger flows through pino's `scrubObject` hook and is captured by Railway's JSON log aggregator. Added import for `@/lib/logger`.

---

### CR-03: Hardcoded dummy Turnstile token in DSRRequestCard delete flow

**Files modified:** `src/components/settings/DSRRequestCard.tsx`
**Commit:** `a2105d4`
**Applied fix:** Added a `NODE_ENV === 'production'` runtime guard at the top of `submitDelete` that detects any token starting with `'dummy-'` and surfaces a user-facing error message instead of sending the request (which would return 400 from the server). Annotated the `onConfirm` callsite with `// TODO(phase2)` comment tracking the real `@marsidev/react-turnstile` widget integration.

---

### WR-01: dsrAcknowledgeWorker fetches DSR row without user_id filter

**Files modified:** `src/jobs/workers/dsrAcknowledgeWorker.ts`, `src/app/api/privacy/delete/route.ts`, `src/app/api/privacy/export/route.ts`
**Commit:** `6b8ca3b`
**Applied fix:** Added `user_id: string` field to `DsrAcknowledgePayload` interface. Updated the Drizzle query to use `and(eq(dsr_requests.id, ...), eq(dsr_requests.user_id, ...))` with the `and` helper imported from `drizzle-orm`. Updated both enqueue call sites (delete and export routes) to include `user_id: userId` in the job payload.

---

### WR-02: sesBounceWorker does not mark event as processed when recipients list is empty

**Skipped** — see Skipped Issues section below.

---

### WR-03: Worker error handling silently drops failed individual jobs

**Files modified:** `src/jobs/workers/dsrAcknowledgeWorker.ts`, `src/jobs/workers/sesBounceWorker.ts`, `src/jobs/workers/passwordResetEmailWorker.ts`, `src/jobs/workers/accountUnlockEmailWorker.ts`
**Commit:** `becc4f2`
**Applied fix:** Wrapped each job's processing body in `try/catch` across all four workers. On error, `logger.error` emits a structured log with `event`, `job_id`, `worker` name, and `error` fields, then re-throws so pg-boss retries the failed job. Also added `import { logger }` to `passwordResetEmailWorker.ts` and `accountUnlockEmailWorker.ts` (previously missing). As a side-effect, also fixed the IN-03 `console.warn` in `dsrAcknowledgeWorker` — replaced with `logger.warn` with a structured event field.

---

### WR-04: `consentVersions.ts` falls back to `'fallback000000'` silently in production

**Files modified:** `src/lib/consentVersions.ts`
**Commit:** `9d0b510`
**Applied fix:** Added an OPS-04-style production guard in the `catch` block of `short_sha()`. When `NODE_ENV === 'production'` and `NEXT_PHASE !== 'phase-production-build'`, the function now throws an `Error` with a descriptive OPS-04 message naming the missing file. In development and CI the fallback `'fallback000000'` is retained (module must not throw at import time during build steps).

---

### WR-05: `sentry.server.config.ts` and `sentry.edge.config.ts` enabled in development

**Files modified:** `sentry.server.config.ts`, `sentry.edge.config.ts`
**Commit:** `2124fb7`
**Applied fix:** Changed `enabled` from `process.env.NODE_ENV !== 'test'` to `process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test'` in both configs, matching the existing `sentry.client.config.ts` convention. This prevents local stack traces and file paths from being shipped to Sentry EU during development.

---

## Skipped Issues

### WR-02: sesBounceWorker does not mark event as processed when recipients list is empty

**File:** `src/jobs/workers/sesBounceWorker.ts:79-111`
**Reason:** Code already implements the fix. The `processed_at` update (lines 106-110 in the original file) is already positioned OUTSIDE the inner `for (const email of recipients)` loop — it executes unconditionally after the loop body regardless of whether `recipients` is empty. The reviewer's concern described the desired behavior; the actual implementation already matches it. No change required.

---

_Fixed: 2026-04-22T21:41:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
