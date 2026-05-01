---
status: partial
phase: 01-foundation-identity
source: [01-VERIFICATION.md]
started: 2026-04-22T23:59:00Z
updated: 2026-05-01T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. SES email delivery end-to-end
expected: Email arrives in inbox from `no-reply@portalfinance.app` with correct pt-BR copy; SES delivery metrics show no bounces. Trigger via password-reset or account-unlock flow.
why_human: SES production access and SNS subscription (Plan 01-04 Task 4) are deferred ops tasks. Code path cannot be exercised without live AWS credentials and a confirmed SNS subscription.
result: blocked
blocked_by: third-party
reason: |
  AWS Support denied the SES production-access request without specific
  remediation guidance: "we are unable to approve an increase at this
  time... Due to security reasons, we are unable to provide specific
  details about our assessment criteria." Pointed to the AWS Acceptable
  Use Policy and Service Terms. Until access is granted (appeal, new
  account, or alternative ESP), SES is sandbox-only — sends to
  non-verified addresses fail.

### 2. Sentry EU captures a real error with CPF scrubbed
expected: Event appears in the Sentry EU (`de.sentry.io`) project with message containing `[CPF]` rather than the raw digits; `user.id` is a 16-char hex hash, not a UUID.
why_human: Requires a live Sentry EU project with a valid `SENTRY_DSN` ending in `de.sentry.io` and a deployed web service. Cannot be verified statically or in unit tests.
result: pass
verified: 2026-04-30
verified_via: |
  Temporary debug route /api/debug/sentry (gated by DEBUG_SENTRY_KEY in
  SSM) emitted both Sentry.captureException + Sentry.captureMessage
  carrying a sample CPF "123.456.789-00" and a fake user.id UUID.
  Both events landed in https://portal-finance.sentry.io/issues/?project=4511278780448848
  with title "...for user [CPF]" (raw CPF stripped) and user.id
  "db616d90e99c0e8e" (16-char lowercase hex). user.email and ip dropped.
  Confirms beforeSend + hashUserIdForSentry are active end-to-end.
diagnostic_finding: |
  This UAT surfaced a latent production bug: with the `src/` directory
  layout, Next 15/16 only loads `instrumentation.ts` from
  `src/instrumentation.ts` — the file at the project root was silently
  ignored, so Sentry SDK never initialized in prod. Moved
  `instrumentation.ts` -> `src/instrumentation.ts` (relative imports
  to root-level sentry.{server,edge}.config updated to ../). Without
  this fix, every Phase 01 prod error was being dropped silently.

### 3. End-to-end register → login → refresh persistence on deployed AWS Copilot prod
expected: User completes signup on the production URL (https://portalfinance.app), logs in, refreshes — session persists. Logout deletes the server-side session row.
why_human: The e2e Playwright test runs against localhost with a testcontainers DB. Production verification (AWS Copilot sa-east-1 RDS Postgres with real `DATABASE_URL`, `NEXTAUTH_SECRET`, etc., per Phase 01.1) requires human interaction on the deployed site.
result: issue
reported: "Login error: POST https://portalfinance.app/api/auth/login 401 (Unauthorized)"
severity: blocker

### 4. SES bounce pipeline end-to-end
expected: Send to `bounce@simulator.amazonses.com` from the production environment; a row appears in `ses_suppressions` for that address within 60 seconds of send; a second send attempt returns `{ suppressed: true }` from the mailer.
why_human: Requires live SES production access, SNS topic subscription, and the deployed webhook endpoint. All code-side work is verified by integration tests; the ops configuration is deferred (STATE.md Deferred Items).
result: issue
reported: |
  Tried two recipients from the deployed prod env via /reset:
  (1) bounce@simulator.amazonses.com — no logs anywhere (no
      `password_reset_email_sent` from worker, no `ses_bounce_received`
      on web). Send appears to silently no-op or never reach SES.
  (2) alessandro.holanda@hotmail.com — email arrived (so SES IS sending
      to identities the account can reach), but the CTA button shows
      `[/api/auth/reset/confirm?token=mC_h-f0pRzCjOeCVq5u0TKtR019QjNG9l_VUOCCFTDA]Redefinir senha`
      instead of a clickable button. Two bugs in one line: relative
      URL (no scheme/host) AND wrong path (points at API route, not
      `/reset/confirm` UI page).
severity: blocker

## Summary

total: 4
passed: 1
issues: 2
pending: 0
skipped: 0
blocked: 1

## Gaps

- truth: "User completes signup on https://portalfinance.app, logs in, and stays logged in across refresh; logout deletes the server-side session row."
  status: failed
  reason: "User reported: Login error: POST https://portalfinance.app/api/auth/login 401 (Unauthorized)"
  severity: blocker
  test: 3
  artifacts: []
  missing: []

- truth: "Send to bounce@simulator.amazonses.com from prod produces (a) a write to ses_suppressions within 60s and (b) suppression-blocked second send."
  status: failed
  reason: "User reported: tried bounce@simulator.amazonses.com from /reset on prod — zero logs anywhere (no `password_reset_email_sent` from worker, no `ses_bounce_received` on web). Either the send never reaches SES (sandbox identity gating), or the worker is not registered for the password-reset queue, or the SES configuration set / SNS event-destination is missing."
  severity: blocker
  test: 4
  artifacts: []
  missing: []

- truth: "Password-reset email contains a working CTA button that opens the reset-confirm UI on portalfinance.app."
  status: failed
  reason: "User reported: email button rendered as `[/api/auth/reset/confirm?token=...]Redefinir senha`. Confirmed bug at src/app/api/auth/reset/request/route.ts:95 — `reset_link` is `/api/auth/reset/confirm?token=${token}`. Two defects: (1) relative URL with no origin (must be `${NEXTAUTH_URL}/reset/confirm?token=...`); (2) wrong path — the API route is not the UI page (page is src/app/(auth)/reset/confirm/page.tsx, accessed at `/reset/confirm`)."
  severity: blocker
  test: 4
  artifacts:
    - src/app/api/auth/reset/request/route.ts:95
    - src/emails/PasswordReset.tsx
    - src/app/(auth)/reset/confirm/page.tsx
  missing: []
