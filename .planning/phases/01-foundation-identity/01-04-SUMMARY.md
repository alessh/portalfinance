---
phase: 01-foundation-identity
plan: "04"
subsystem: observability
tags: [sentry, pino, ses, webhook, ops-04, demo-dashboard, lgpd]
dependency_graph:
  requires:
    - 01-03 (piiScrubber, webhook_events schema, boss.ts, QUEUES.SES_BOUNCE)
    - 01-02 (env.ts, session.ts, dashboard/page.tsx stub)
    - 01-01 (Sentry SDK stub, DB schema, mailer stub)
  provides:
    - Sentry EU beforeSend (PII-scrubbed) — consumed by all future plans
    - pino logger with scrubObject hook — consumed by all server-side workers
    - OPS-04 boot assertion — guards production deployments
    - SES bounce webhook + sesBounceWorker — idempotent pattern inherited by Phase 2 (Pluggy) + Phase 5 (ASAAS)
    - DemoDashboard at /dashboard — value-before-bank-connection UX
    - EmailVerificationNagBanner — persistent nag until email verified
  affects:
    - src/jobs/worker.ts (sesBounceWorker registered)
    - src/app/dashboard/page.tsx (replaced minimal stub with real dashboard)
    - src/lib/env.ts (OPS-04 refines added, LOG_LEVEL + SERVICE_NAME added)
tech_stack:
  added:
    - "@sentry/nextjs@10.49.0 — Sentry EU error capture"
    - "pino@10.3.1 — structured JSON logger (server)"
    - "pino-pretty@13.0.0 (dev) — human-readable dev output"
    - "sns-validator — AWS SNS X.509 signature verification"
    - "@types/sns-validator@0.3.3 (dev) — TypeScript definitions"
  patterns:
    - "Synchronous beforeSend — Sentry swallows async beforeSend (RESEARCH.md Pitfall 5)"
    - "NEXT_PHASE=phase-production-build bypass — OPS-04 guards skip during next build, fire at server startup"
    - "pino hooks.logMethod — meta objects passed through scrubObject before log emission"
    - "Idempotent webhook_events UNIQUE(source, event_id) — onConflictDoNothing; enqueue after insert"
    - "200 < 200ms webhook response — SNS requires fast ack; real work deferred to pg-boss worker"
key_files:
  created:
    - src/lib/sentry.ts
    - sentry.server.config.ts
    - sentry.client.config.ts
    - sentry.edge.config.ts
    - instrumentation.ts
    - instrumentation-client.ts
    - src/lib/logger.ts
    - src/lib/logger.edge.ts
    - src/lib/snsVerifier.ts
    - src/app/api/webhooks/ses/bounces/route.ts
    - src/jobs/workers/sesBounceWorker.ts
    - src/components/demo/DemoDashboard.tsx
    - src/components/banners/EmailVerificationNagBanner.tsx
    - src/lib/demoData.ts
    - src/lib/formatCurrency.ts
    - tests/unit/observability/sentry-scrubber.test.ts
    - tests/unit/lib/logger.test.ts
    - tests/integration/webhooks/ses-bounce.test.ts
    - tests/fixtures/env-runner/env-runner.ts
    - tests/fixtures/sns-fixtures.ts
    - tests/integration/observability/env-assert.test.ts
    - docs/ops/ses-production-access.md
    - docs/ops/encryption-key-rotation.md
    - README.md
  modified:
    - src/lib/env.ts (OPS-04 refines + LOG_LEVEL + SERVICE_NAME + NEXT_PHASE build bypass)
    - src/jobs/worker.ts (sesBounceWorker registered, pino logger wired)
    - src/app/dashboard/page.tsx (replaced minimal stub with DemoDashboard + EmailVerificationNagBanner)
    - tests/unit/lib/env.test.ts (3 new OPS-04 cases)
decisions:
  - "Synchronous beforeSend: RESEARCH.md Pitfall 5 explicitly warns Sentry swallows async beforeSend; kept sync even though it slightly slows error capture path"
  - "Single sentry.ts with edge-safe hash gate: typeof process?.versions?.node detects edge runtime; edge drops user object entirely rather than hashing (middleware traffic rarely has user IDs)"
  - "NEXT_PHASE build bypass: OPS-04 guards only fire at server startup (instrumentation.ts), not during next build static generation; this allows CI builds without prod credentials"
  - "No Recharts in DemoDashboard: UI-SPEC § 2.10 explicitly forbids Recharts in Phase 1; CSS-based horizontal bar list used instead"
  - "sns-validator (npm) over manual X.509: handles cert URL fetching + caching per SNS spec; avoids reimplementing HTTPS cert fetch + XML parse"
metrics:
  duration_minutes: 180
  completed_date: "2026-04-22"
  tasks_completed: 3
  tasks_total: 4
  files_created: 24
  files_modified: 4
---

# Phase 01 Plan 04: Observability Close-out Summary

**One-liner:** Sentry EU with piiScrubber-backed synchronous `beforeSend`, pino structured logger, OPS-04 Zod boot assertion, SES bounce SNS webhook with idempotent `webhook_events` pattern, and DemoDashboard with BR middle-class illustrative data.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Sentry EU + pino logger + OPS-04 env guard | `023bfd8` | sentry.ts, sentry.*.config.ts, instrumentation.ts, logger.ts, env.ts |
| 2 | SES bounce SNS webhook + sesBounceWorker | `2a74b19` | webhooks/ses/bounces/route.ts, sesBounceWorker.ts, snsVerifier.ts |
| 3 | DemoDashboard + EmailVerificationNagBanner + runbooks + README | `05f9efd` | DemoDashboard.tsx, EmailVerificationNagBanner.tsx, demoData.ts, ops/*.md, README.md |
| 4 | SES production access (human-action checkpoint) | — | Awaiting human: domain registration, SPF/DKIM/DMARC, SES production request, SNS topic |

## Checkpoint: Task 4 Awaiting Human Action

Task 4 is a `checkpoint:human-action`. The following manual steps are required before SES email delivery goes live:

1. **Verify apex domain** `portalfinance.app` is registered and DNS zone is under your control.
2. **Configure SPF + DKIM** via AWS SES Verified Identities (SES manages DKIM keys; add CNAMEs to DNS).
3. **Configure DMARC** `p=none rua=mailto:dmarc@portalfinance.app` on apex DNS.
4. **Request SES production access** — use the verbatim justification in `docs/ops/ses-production-access.md`. Wait 24–48h for AWS approval.
5. **Create SNS topic** `ses-bounces` in `sa-east-1` and subscribe `https://portalfinance.app/api/webhooks/ses/bounces` (HTTPS). The webhook auto-confirms the subscription on first SubscriptionConfirmation message.
6. **Wire SES identity notifications** — Bounces + Complaints publish to the SNS topic.
7. **Create Sentry EU project** at `https://sentry.io/signup/` → select EU data residency → copy DSN (must end with `de.sentry.io`).
8. **Set Railway env vars:** `SENTRY_DSN`, `SENTRY_ENV=production`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=sa-east-1`, `SES_FROM_EMAIL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`.

See full runbook: `docs/ops/ses-production-access.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ErrorEvent vs Event type for Sentry beforeSend**
- **Found during:** Task 1
- **Issue:** `@sentry/types` `Event` type is not the correct type for the `beforeSend` option; Sentry requires `ErrorEvent`. Using wrong type caused TypeScript inference errors in test fixtures.
- **Fix:** Changed all `Event` imports to `ErrorEvent` from `@sentry/nextjs`; added `as ErrorEvent` casts at test call sites.
- **Files modified:** `src/lib/sentry.ts`, `sentry.client.config.ts`, `tests/unit/observability/sentry-scrubber.test.ts`
- **Commit:** `023bfd8`

**2. [Rule 3 - Blocking] tsx subprocess path alias resolution failure**
- **Found during:** Task 1 (integration env-assert tests)
- **Issue:** `spawnSync('tsx', ...)` failed on Windows (no .bin symlink resolution). Switching to `process.execPath + [tsx/dist/cli.mjs]` worked, but `@/lib/env` alias resolved as `tests/src/lib/env` (wrong base dir) in subprocess context.
- **Fix:** Used relative path `../../../src/lib/env` in env-runner.ts (3 levels up from `tests/fixtures/env-runner/`), bypassing the broken tsconfig `paths` resolution in subprocess context.
- **Files modified:** `tests/fixtures/env-runner/env-runner.ts`, `tests/integration/observability/env-assert.test.ts`
- **Commit:** `023bfd8`

**3. [Rule 1 - Bug] PII key-based redaction conflict in logger test**
- **Found during:** Task 1 (logger unit test)
- **Issue:** Test used `description` key in the pino meta object, but `description` is in `PII_KEYS` (key-based redaction → `[REDACTED]`), so the CPF pattern test failed expecting `[CPF]` but got `[REDACTED]`.
- **Fix:** Changed test to use `note` key (not in PII_KEYS) which exercises string-based scrubbing of CPF pattern correctly.
- **Files modified:** `tests/unit/lib/logger.test.ts`
- **Commit:** `023bfd8`

**4. [Rule 1 - Bug] JSX in .ts integration test file**
- **Found during:** Task 2 (ses-bounce integration test)
- **Issue:** `<div>test</div>` JSX syntax in a `.ts` file (not `.tsx`) caused TypeScript parse failure.
- **Fix:** Replaced with `createElement('div', null, 'test')` from React.
- **Files modified:** `tests/integration/webhooks/ses-bounce.test.ts`
- **Commit:** `2a74b19`

**5. [Rule 2 - Missing Critical] OPS-04 guard fires during next build**
- **Found during:** Task 3 (build verification)
- **Issue:** `pnpm build` sets `NODE_ENV=production` (Next.js optimization). The OPS-04 Zod refine fires at module evaluation during static page generation, failing the build without prod credentials present.
- **Fix:** Added `if (process.env.NEXT_PHASE === 'phase-production-build') return true;` bypass in all three OPS-04 refines. Guards still fire at server startup (instrumentation.ts boot). Added `NEXT_PHASE: undefined` to integration test subprocess env to ensure tests are robust.
- **Files modified:** `src/lib/env.ts`, `tests/integration/observability/env-assert.test.ts`
- **Commit:** `05f9efd`

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `/api/auth/email/resend` returns 501 | `src/components/banners/EmailVerificationNagBanner.tsx` line 54 | Intentional Phase 1 stub (D-02). Phase 2 wires real SES email verification flow. Banner UX is optimistic. |
| `Conectar banco →` link `aria-disabled="true"` | `src/components/demo/DemoDashboard.tsx` line 93 | Intentional — `/connect` route does not exist until Phase 2 (Pluggy integration). |

## Threat Flags

None — this plan's new network endpoints (webhook receiver, dashboard page) were already in the plan's threat model. The SES bounce webhook verifies SNS X.509 signatures before processing. The dashboard page is gated by `requireSession()`.

## Self-Check: PASSED

Files verified:
- `src/lib/sentry.ts` — EXISTS
- `sentry.server.config.ts` — EXISTS
- `sentry.client.config.ts` — EXISTS
- `sentry.edge.config.ts` — EXISTS
- `instrumentation.ts` — EXISTS
- `src/lib/logger.ts` — EXISTS
- `src/lib/snsVerifier.ts` — EXISTS
- `src/app/api/webhooks/ses/bounces/route.ts` — EXISTS
- `src/jobs/workers/sesBounceWorker.ts` — EXISTS
- `src/components/demo/DemoDashboard.tsx` — EXISTS
- `src/components/banners/EmailVerificationNagBanner.tsx` — EXISTS
- `src/lib/demoData.ts` — EXISTS
- `src/lib/formatCurrency.ts` — EXISTS
- `docs/ops/ses-production-access.md` — EXISTS
- `docs/ops/encryption-key-rotation.md` — EXISTS
- `README.md` — EXISTS

Commits verified:
- `023bfd8` — EXISTS (Task 1)
- `2a74b19` — EXISTS (Task 2)
- `05f9efd` — EXISTS (Task 3)

Test suite results (verified post-continuation):
- Unit tests: 45 passed, 0 failed (9 test files)
- Integration tests: 33 passed, 0 failed (9 test files)
- Total: 78 tests passing, 0 failures
- TypeScript: clean (tsc --noEmit exits 0)
- Build: `pnpm build` passes cleanly

Task 4 deferred: SES production access + Sentry EU console setup recorded in STATE.md Deferred Items (category: Ops). Runbook available at `docs/ops/ses-production-access.md`.
