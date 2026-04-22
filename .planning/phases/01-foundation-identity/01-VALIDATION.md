---
phase: 1
slug: foundation-identity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x (unit + integration) + Playwright 1.49 (e2e) + testcontainers-node (ephemeral Postgres) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` (both installed in Wave 0) |
| **Quick run command** | `npm run test:unit` (Vitest, unit scope only) |
| **Full suite command** | `npm run test:all` (unit + integration with testcontainers + e2e against local build) |
| **Estimated runtime** | Quick: ~15 s · Full: ~90 s (first run ~180 s due to Postgres container pull) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `npm run test:all`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds (quick) / 90 seconds (full)

---

## Per-Task Verification Map

*Populated by planner from RESEARCH.md Validation Architecture (10 Nyquist dimensions). The planner MUST preserve the dimension → test-command mapping and attach a task ID per row.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-00-00 | 00 | 0 | — | — | Test infra available | infra | `npm run test:unit -- --run --reporter=basic` | ❌ W0 | ⬜ pending |
| 1-01-XX | 01 | 1 | OPS-01 | — | Drizzle migration idempotence | integration | `npm run test:integration -- db/migrations.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-XX | 01 | 1 | OPS-01 | — | `subscription_tier` defaults to "paid" | integration | `npm run test:integration -- db/users-schema.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-XX | 02 | 2 | AUTH-01 / AUTH-03 | T-AUTH-CPF | CPF check-digit validation + format round-trip | unit | `npm run test:unit -- lib/cpf.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-XX | 02 | 2 | AUTH-01 / SEC-02 | T-AUTH-CPF-AT-REST | AES-256-GCM encrypt/decrypt CPF round-trip | unit | `npm run test:unit -- lib/crypto.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-XX | 02 | 2 | AUTH-01 / AUTH-02 | T-AUTH-PWHASH | argon2 hash + verify | unit | `npm run test:unit -- lib/password.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-XX | 02 | 2 | AUTH-02 / AUTH-05 | T-AUTH-CREDS | Register → login → session persisted → refresh still logged in | e2e | `npm run test:e2e -- auth.spec.ts` | ❌ W0 | ⬜ pending |
| 1-02-XX | 02 | 2 | AUTH-04 / AUTH-06 | T-AUTH-BRUTE | 429 returned after threshold on login + password-reset; unlock email works | integration | `npm run test:integration -- auth/rate-limit.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-XX | 02 | 2 | SEC-01 | T-IDOR-BASE | IDOR guard: queries filter by `user_id` from session | integration | `npm run test:integration -- security/idor.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-XX | 03 | 3 | LGPD-01 | T-CONSENT-MISSING | `user_consents` row shape persisted with expected fields | integration | `npm run test:integration -- lgpd/consent.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-XX | 03 | 3 | LGPD-05 / LGPD-06 | — | DSR export/delete stubs enqueue and produce artifact | integration | `npm run test:integration -- lgpd/dsr.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-XX | 03 | 3 | LGPD-01 | T-PII-LEAK | `piiScrubber` removes CPF (dotted + raw) and email from strings | unit | `npm run test:unit -- lib/pii-scrubber.test.ts` | ❌ W0 | ⬜ pending |
| 1-04-XX | 04 | 4 | OPS-04 | T-PII-LEAK | Sentry `beforeSend` strips CPF + email before shipping | unit | `npm run test:unit -- observability/sentry-scrubber.test.ts` | ❌ W0 | ⬜ pending |
| 1-04-XX | 04 | 4 | OPS-01 | T-ENV-MISMATCH | Production startup asserts sandbox creds absent — throws before serving | integration | `npm run test:integration -- observability/env-assert.test.ts` | ❌ W0 | ⬜ pending |
| 1-04-XX | 04 | 4 | OPS-04 | T-WH-REPLAY | SES bounce webhook idempotency via `webhook_events` dedup | integration | `npm run test:integration -- webhooks/ses-bounce.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner substitutes `XX` with the actual task slot once plan tasks are authored.*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — node + happy-dom environments split by pattern
- [ ] `playwright.config.ts` — baseURL points at locally built Next.js; `npm run build && npm start` pre-step
- [ ] `tests/setup.ts` — shared Vitest setup (env vars, `loadEnvConfig`)
- [ ] `tests/fixtures/db.ts` — testcontainers-Postgres spin-up; runs Drizzle migrations
- [ ] `tests/fixtures/mailer.ts` — in-memory SES mock
- [ ] `package.json` scripts: `test:unit`, `test:integration`, `test:e2e`, `test:all`
- [ ] Install: `vitest`, `@vitest/ui`, `@testing-library/react`, `happy-dom`, `@playwright/test`, `testcontainers`, `msw`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Railway `sa-east-1` region actually provisioned | OPS-01 | Infra provisioning action; no programmatic assertion possible before project creation | Confirm via Railway dashboard that web + worker + Postgres all show region = `sa-east-1` (Brazilian territory) |
| Sentry EU DSN resolves to `de.sentry.io` in prod runtime | OPS-04 | DSN is a deployment secret; assert once per environment | Trigger test exception in prod build, confirm event lands in Sentry EU org dashboard with CPF/email scrubbed |
| AWS SES production access granted | AUTH-06 / LGPD-05 | AWS review 24–48 h, cannot automate | Confirm SES console shows "Production access" + sending quota ≥ configured limit |
| `@serwist/next` manifest renders on mobile install prompt | Phase 4 precursor | Requires real device; Phase 4 has the full PWA checkpoint | Deferred to Phase 4 — Phase 1 only places the bootstrap hook |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15 s quick / < 90 s full
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
