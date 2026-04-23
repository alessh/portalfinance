---
status: partial
phase: 01-foundation-identity
source: [01-VERIFICATION.md]
started: 2026-04-22T23:59:00Z
updated: 2026-04-22T23:59:00Z
---

## Current Test

[awaiting human testing — items below cannot be exercised without live external services and the deployed Railway sa-east-1 environment]

## Tests

### 1. SES email delivery end-to-end
expected: Email arrives in inbox from `no-reply@portalfinance.com.br` with correct pt-BR copy; SES delivery metrics show no bounces. Trigger via password-reset or account-unlock flow.
why_human: SES production access and SNS subscription (Plan 01-04 Task 4) are deferred ops tasks. Code path cannot be exercised without live AWS credentials and a confirmed SNS subscription.
result: [pending]

### 2. Sentry EU captures a real error with CPF scrubbed
expected: Event appears in the Sentry EU (`de.sentry.io`) project with message containing `[CPF]` rather than the raw digits; `user.id` is a 16-char hex hash, not a UUID.
why_human: Requires a live Sentry EU project with a valid `SENTRY_DSN` ending in `de.sentry.io` and a deployed web service. Cannot be verified statically or in unit tests.
result: [pending]

### 3. End-to-end register → login → refresh persistence on deployed Railway instance
expected: User completes signup on the production URL, logs in, refreshes — session persists. Logout deletes the server-side session row.
why_human: The e2e Playwright test runs against localhost with a testcontainers DB. Production verification (Railway sa-east-1 Postgres with real `DATABASE_URL`, `NEXTAUTH_SECRET`, etc.) requires human interaction on the deployed site.
result: [pending]

### 4. SES bounce pipeline end-to-end
expected: Send to `bounce@simulator.amazonses.com` from the production environment; a row appears in `ses_suppressions` for that address within 60 seconds of send; a second send attempt returns `{ suppressed: true }` from the mailer.
why_human: Requires live SES production access, SNS topic subscription, and the deployed webhook endpoint. All code-side work is verified by integration tests; the ops configuration is deferred (STATE.md Deferred Items).
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
