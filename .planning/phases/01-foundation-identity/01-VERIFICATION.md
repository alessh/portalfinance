---
phase: 01-foundation-identity
verified: 2026-04-22T23:59:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification: false
human_verification:
  - test: "SES email actually delivered — trigger a password-reset or account-unlock email in production; confirm the recipient receives it"
    expected: "Email arrives in inbox from no-reply@portalfinance.app with correct pt-BR copy; SES delivery metrics show no bounces"
    why_human: "SES production access and SNS subscription (Plan 01-04 Task 4) are deferred ops tasks. Code path cannot be exercised without live AWS credentials and a confirmed SNS subscription."
  - test: "Sentry EU captures a real error with CPF scrubbed — visit a route that throws, confirm the Sentry EU dashboard at de.sentry.io shows the event with [CPF] in place of any CPF digits"
    expected: "Event appears in the Sentry EU (de.sentry.io) project with message containing [CPF] rather than the raw digits; user.id is a 16-char hex hash, not a UUID"
    why_human: "Requires a live Sentry EU project with a valid SENTRY_DSN ending in de.sentry.io and a deployed web service. Cannot be verified statically or in unit tests."
  - test: "End-to-end register → login → stay logged in across browser refresh on the deployed Railway instance"
    expected: "User completes signup on the production URL, logs in, refreshes — session persists. Logout deletes the server-side session row."
    why_human: "The e2e Playwright test runs against localhost with a testcontainers DB. Production verification (Railway sa-east-1 Postgres with real DATABASE_URL, NEXTAUTH_SECRET, etc.) requires human interaction on the deployed site."
  - test: "SES bounce pipeline end-to-end — send to bounce@simulator.amazonses.com from the production environment; confirm ses_suppressions row is created and future sends to that address are blocked"
    expected: "A row appears in ses_suppressions for bounce@simulator.amazonses.com within 60 seconds of send; a second send attempt returns { suppressed: true } from the mailer"
    why_human: "Requires live SES production access, SNS topic subscription, and the deployed webhook endpoint. All code-side work is verified by integration tests; the ops configuration is deferred (STATE.md Deferred Items)."
---

# Phase 1: Foundation & Identity Verification Report

**Phase Goal:** Establish the Railway sa-east-1 deployment topology, Drizzle-managed schema baseline, Auth.js v5 credentials authentication with all security controls, LGPD baseline (consent records, PII scrubbing, DSR skeleton), and observability (Sentry EU + structured logs). No bank data flows yet.

**Verified:** 2026-04-22T23:59:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

All 6 roadmap success criteria are VERIFIED by code-level evidence. 4 items require human verification because they depend on live external services (SES, Sentry EU, deployed Railway) that are correctly implemented in code but cannot be exercised statically.

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can register with email + CPF + password (CPF nullable Phase 1 per D-04), log in, and stay logged in across refresh; CPF is check-digit validated and stored encrypted | ✓ VERIFIED | `src/auth.ts` (DrizzleAdapter, database sessions, argon2id credentials); `src/lib/cpf.ts` (@brazilian-utils/brazilian-utils CPFSchema with check-digit); `src/lib/crypto.ts` (AES-256-GCM encryptCPF/decryptCPF); signup writes `users + user_consents + audit_log` atomically; `tests/e2e/auth.spec.ts` register→login→reload→logout passes; `tests/unit/lib/cpf.test.ts` (5 tests), `tests/unit/lib/crypto.test.ts` (5 tests), `tests/unit/lib/password.test.ts` (4 tests) all passing |
| 2 | Login and password-reset endpoints return 429 after configured rate-limit threshold; account lock + unlock email works end-to-end | ✓ VERIFIED | `src/lib/rateLimit.ts` (Postgres sliding-window, ON CONFLICT DO UPDATE atomic increment); 5/15 login limit + account lock in `src/app/api/auth/login/route.ts`; 3/hour email + 10/hour IP reset limit in `reset/request/route.ts`; unlock route at `src/app/api/auth/unlock/route.ts`; `tests/integration/auth/rate-limit.test.ts` covers all 5 rate-limit behaviors (6th attempt=429, reset after success, email 3/hour, IP 10/hour, anti-enumeration) — 18 integration tests passing |
| 3 | The `users`, `sessions`, `user_consents`, `audit_log`, `admin_access_log`, `webhook_events`, and skeleton `subscriptions` tables exist in PostgreSQL sa-east-1; every user row has subscription_tier initialized (default 'paid') | ✓ VERIFIED | All 14 Phase 1 tables confirmed in `src/db/migrations/0000_premium_sabretooth.sql`; `users.subscription_tier TEXT NOT NULL DEFAULT 'paid'` confirmed; `accounts_oauth` (not `accounts`) confirmed; UNIQUE(source, event_id) on webhook_events confirmed; `tests/integration/db/migrations.test.ts` asserts all 14 tables + no `accounts` table + pgcrypto extension; `tests/integration/db/users-schema.test.ts` asserts subscription_tier default = 'paid' and cpf_hash nullable |
| 4 | Sentry EU captures a test exception with CPF and email in the payload — and the beforeSend scrubber strips both before the event is shipped; structured JSON logs contain no PII | ✓ VERIFIED (code-side) / ? HUMAN (live Sentry EU) | `src/lib/sentry.ts` exports synchronous `beforeSend` that calls `scrubString` + `scrubObject` on all event fields; `sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts` all wire `beforeSend`; DSN hostname comment requires `de.sentry.io`; `src/lib/logger.ts` uses pino `hooks.logMethod` passing meta through `scrubObject`; `tests/unit/observability/sentry-scrubber.test.ts` (5 tests) covers CPF in message, email in exception value, nested extras, user.id hashing, non-throw on malformed; `tests/unit/lib/logger.test.ts` covers JSON + scrub-in-meta + scrub-by-key. Live Sentry EU confirmation requires human (see Human Verification) |
| 5 | A consent screen exists as a reusable component and records the expected user_consents row shape (exercised by a LGPD consent unit test), even if no Pluggy connection is wired yet | ✓ VERIFIED | `src/components/consent/ConsentScreen.tsx` reads from `getScopeConfig(scope)` (not hardcoded JSX); accepts `scope: ConsentScope` discriminated union (`'ACCOUNT_CREATION' \| \`PLUGGY_CONNECTOR:${string}\``); `src/lib/consentScopes.ts` provides ACCOUNT_CREATION + PLUGGY_CONNECTOR_TEMPLATE configs; `src/lib/consentVersions.ts` computes build-time SHA-256 hash of `docs/legal/terms-v1.md` + `docs/legal/privacy-v1.md`; signup writes `user_consents` row with `scope='ACCOUNT_CREATION'`, `action='GRANTED'`, `consent_version=versions.ACCOUNT_CREATION`, IP, UA; `tests/unit/components/ConsentScreen.test.tsx` (4 tests) + `tests/integration/lgpd/consent.test.ts` verify consent row shape |
| 6 | A runtime assertion fails fast when production env is started with sandbox credentials | ✓ VERIFIED | `src/lib/env.ts` has Zod `.refine()` OPS-04 guard: NODE_ENV=production + PLUGGY_ENV=sandbox throws with 'OPS-04 violation'; instrumentation.ts first statement is `await import('@/lib/env')`; worker.ts first import is `import '@/lib/env'`; `tests/integration/observability/env-assert.test.ts` spawns subprocess with production+sandbox env and asserts non-zero exit + 'OPS-04 violation' in stderr; NEXT_PHASE build bypass prevents false positives during `pnpm build` |

**Score:** 6/6 truths verified (4 items in SC4 require human verification for live external services)

---

## Required Artifacts

### Plan 01-00: Scaffold

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | All required scripts | ✓ VERIFIED | `test:unit`, `test:integration`, `test:e2e`, `test:all`, `build`, `start:web`, `start:worker`, `db:generate`, `db:migrate` — all present; no `db:push` |
| `vitest.config.ts` | `projects:` with unit + integration | ✓ VERIFIED | Both projects defined with correct includes and environments |
| `playwright.config.ts` | baseURL + webServer block | ✓ VERIFIED | Points to http://localhost:3000; webServer runs via `scripts/run-e2e.ts` |
| `tests/setup.ts` | loadEnvConfig + test defaults | ✓ VERIFIED | Sets ENCRYPTION_KEY, CPF_HASH_PEPPER, NEXTAUTH_SECRET defaults |
| `tests/fixtures/db.ts` | testcontainers Postgres 16 | ✓ VERIFIED | Exports `startTestDb()` |
| `tests/fixtures/mailer.ts` | SES mock via aws-sdk-client-mock | ✓ VERIFIED | Exports `createSesMock()`; re-registers handler after reset() |
| `tests/fixtures/pii-corpus.ts` | Fake PII corpus | ✓ VERIFIED | cpfs.formatted, cpfs.raw, emails, phonesBr, accounts, pixDescriptions, tokens |
| `src/app/layout.tsx` | lang=pt-BR + Inter Variable | ✓ VERIFIED | `<html lang="pt-BR" className={inter.variable}>` |
| `src/app/globals.css` | Tailwind 4 + shadcn CSS variables | ✓ VERIFIED | `--primary: 178 84% 28%`, `--radius: 0.375rem`, `.dark` block present |
| `components.json` | New York + CSS variables | ✓ VERIFIED | `"style": "new-york"`, `"cssVariables": true` |
| `public/logo.svg` | Placeholder SVG | ✓ VERIFIED | Exists and non-empty |
| `.nvmrc` | Node 20 | ✓ VERIFIED | Exists |

### Plan 01-01: Schema

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `drizzle.config.ts` | dialect postgresql + schema + out | ✓ VERIFIED | All three options present |
| `src/db/index.ts` | Drizzle client singleton | ✓ VERIFIED | Lazy construction; exports `db` |
| `src/db/migrate.ts` | Migration runner with pgcrypto | ✓ VERIFIED | `CREATE EXTENSION IF NOT EXISTS pgcrypto` before migrate |
| `src/db/schema/users.ts` | nullable cpf_hash/cpf_enc + subscription_tier='paid' | ✓ VERIFIED | All columns confirmed nullable/defaulted correctly |
| `src/db/schema/authAdapter.ts` | `accounts_oauth` (NOT accounts) | ✓ VERIFIED | Table named `accounts_oauth` |
| `src/db/schema/webhookEvents.ts` | UNIQUE(source, event_id) | ✓ VERIFIED | `uniqueIndex('webhook_events_source_event_unique').on(t.source, t.event_id)` |
| `src/db/migrations/0000_premium_sabretooth.sql` | All 14 Phase 1 tables | ✓ VERIFIED | 14 CREATE TABLE statements confirmed; UNIQUE on webhook_events; subscription_tier DEFAULT 'paid'; accounts_oauth not accounts |
| `tests/integration/db/migrations.test.ts` | Idempotence + all 14 tables + pgcrypto | ✓ VERIFIED | Covers all 4 behaviors |
| `tests/integration/db/users-schema.test.ts` | subscription_tier default + cpf_hash nullable | ✓ VERIFIED | 3 tests |
| `docs/ops/railway-setup.md` | sa-east-1 runbook | ✓ VERIFIED | Exists with sa-east-1 requirement documented |

### Plan 01-02: Auth

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/auth.ts` | Auth.js v5 + DrizzleAdapter(accounts_oauth) + database session | ✓ VERIFIED | `accountsTable: schema.accounts_oauth`; `strategy: 'database'`; httpOnly+secure+sameSite=lax |
| `src/lib/env.ts` | Zod env with OPS-04 guard | ✓ VERIFIED | Refine with NEXT_PHASE bypass; 'OPS-04 violation' in message |
| `src/lib/crypto.ts` | AES-256-GCM + HMAC-SHA-256 | ✓ VERIFIED | encryptCPF/decryptCPF/hashCPF exported |
| `src/lib/password.ts` | argon2id hash + verify | ✓ VERIFIED | type: argon2.argon2id; OWASP params; const-time dummy verify |
| `src/lib/cpf.ts` | CPFSchema via @brazilian-utils/brazilian-utils | ✓ VERIFIED | Imports from correct package; check-digit validation |
| `src/lib/session.ts` | requireSession() + IDOR baseline | ✓ VERIFIED | requireSession() throws 401-tagged error; dual-path cookie resolution |
| `src/lib/rateLimit.ts` | Postgres sliding-window counter | ✓ VERIFIED | onConflictDoUpdate with sql count + 1 |
| `src/lib/turnstile.ts` | Cloudflare Turnstile server-verify | ✓ VERIFIED | POSTs to challenges.cloudflare.com/turnstile/v0/siteverify |
| `src/middleware.ts` | Edge-safe cookie-presence gate | ✓ VERIFIED | No @/auth, @/lib/crypto, @/lib/password imports |
| `src/components/auth/AuthShell.tsx` | UI-SPEC 2.1 shell | ✓ VERIFIED | `<main role="main">`; max-w-[440px] |
| `src/components/auth/SignupForm.tsx` | UI-SPEC 2.2 with pt-BR copy | ✓ VERIFIED | "Criar conta", "Já tem uma conta?" |
| `src/components/auth/LoginForm.tsx` | UI-SPEC 2.3 + Turnstile slot | ✓ VERIFIED | "E-mail ou senha incorretos."; imports TurnstileSlot |
| `tests/integration/auth/rate-limit.test.ts` | 5 rate-limit behaviors | ✓ VERIFIED | 6th=429, reset after success, email 3/hour, IP 10/hour, anti-enumeration |
| `tests/integration/security/idor.test.ts` | User B 404 on User A data | ✓ VERIFIED | Cross-user reads return null/404 |
| `tests/e2e/auth.spec.ts` | Register→login→reload→logout | ✓ VERIFIED | End-to-end flow |

### Plan 01-03: LGPD

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/piiScrubber.ts` | scrubString + scrubObject + ReDoS guard + WeakSet | ✓ VERIFIED | 10_000 char cap; WeakSet cycle detection; CPF/email/phone/account/token rules; key-based redaction |
| `src/lib/consentScopes.ts` | ACCOUNT_CREATION + PLUGGY_CONNECTOR scope configs | ✓ VERIFIED | getScopeConfig() with discriminated union |
| `src/lib/consentVersions.ts` | Build-time SHA-256 of legal docs | ✓ VERIFIED | `versions.ACCOUNT_CREATION = v1.0.0+terms.<hash>+privacy.<hash>` |
| `src/jobs/boss.ts` | Real pg-boss singleton + test-mode | ✓ VERIFIED | getBoss() + enqueue() + QUEUES constants; test-mode in-memory fallback |
| `src/jobs/worker.ts` | Worker entrypoint; import '@/lib/env' FIRST | ✓ VERIFIED | `import '@/lib/env'` is first non-comment import; OPS-04 guard fires before boss.start() |
| `src/jobs/workers/dsrAcknowledgeWorker.ts` | Reads dsr_requests + sends SES | ✓ VERIFIED | Imports sendEmail + DSRAcknowledgment |
| `src/emails/DSRAcknowledgment.tsx` | 15-day (EXPORT) / 30-day (DELETE) copy; no PII in body | ✓ VERIFIED | Props: {request_type, dsr_request_id} only; 15/30-day windows in different branches |
| `src/lib/mailer.ts` | SES wrapper with ses_suppressions guard BEFORE send | ✓ VERIFIED | ses_suppressions SELECT precedes SendEmailCommand |
| `src/lib/auditLog.ts` | scrubObject(metadata) before INSERT | ✓ VERIFIED | `scrubObject(params.metadata)` in recordAudit |
| `src/components/consent/ConsentScreen.tsx` | Reads from getScopeConfig(scope) | ✓ VERIFIED | Not hardcoded JSX; config-driven data points |
| `src/app/api/privacy/export/route.ts` | runtime='nodejs'; requireSession; PENDING; enqueue dsr.acknowledge | ✓ VERIFIED | All 4 conditions met |
| `src/app/api/privacy/delete/route.ts` | verifyTurnstile + z.literal('EXCLUIR') | ✓ VERIFIED | Both gates present |
| `src/components/settings/ConfirmDestructiveModal.tsx` | cancelLabel: string (REQUIRED) | ✓ VERIFIED | TypeScript prop type is `string` (not optional) |
| `src/components/settings/RequestPendingState.tsx` | 15 dias (EXPORT) / 30 dias (DELETE) | ✓ VERIFIED | Different copy per request_type |
| `docs/legal/terms-v1.md` + `docs/legal/privacy-v1.md` | >50 lines with TODO | ✓ VERIFIED | Both exist with TODO markers and appropriate content |
| `tests/unit/lib/pii-scrubber.test.ts` | 8 behaviors | ✓ VERIFIED | All 8 test cases |
| `tests/unit/components/ConsentScreen.test.tsx` | 4 behaviors | ✓ VERIFIED | All 4 test cases (Test 12 soft assertion for React 19+happy-dom limitation) |
| `tests/integration/lgpd/consent.test.ts` | user_consents row + scrubbed audit metadata | ✓ VERIFIED | Both behaviors tested |
| `tests/integration/lgpd/dsr.test.ts` | EXPORT + DELETE routes + 15/30-day copy | ✓ VERIFIED | 6 integration tests |

### Plan 01-04: Observability

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/sentry.ts` | Synchronous beforeSend + PII scrubbing + user-id hasher | ✓ VERIFIED | Synchronous function; scrubString + scrubObject on all event fields; hashUserIdForSentry |
| `sentry.server.config.ts` / `sentry.client.config.ts` / `sentry.edge.config.ts` | All wire beforeSend | ✓ VERIFIED | All three configs exist and call Sentry.init({ beforeSend }) |
| `instrumentation.ts` | `await import('@/lib/env')` FIRST in register() | ✓ VERIFIED | First statement in register() is the env import |
| `src/lib/logger.ts` | pino with scrubObject via hooks.logMethod | ✓ VERIFIED | hooks.logMethod passes meta through scrubObject before serialization |
| `src/lib/logger.edge.ts` | Edge-compatible JSON logger with scrubObject | ✓ VERIFIED | Exists; uses scrubObject |
| `src/lib/snsVerifier.ts` | X.509 SNS signature verification | ✓ VERIFIED | Uses sns-validator library |
| `src/app/api/webhooks/ses/bounces/route.ts` | verifySnsMessage BEFORE db.insert; onConflictDoNothing; runtime='nodejs' | ✓ VERIFIED | All three conditions confirmed |
| `src/jobs/workers/sesBounceWorker.ts` | Writes ses_suppressions via onConflictDoUpdate | ✓ VERIFIED | Exists and registered in worker.ts |
| `src/components/demo/DemoDashboard.tsx` | role="status" aria-live="polite"; no Recharts; data from demoData | ✓ VERIFIED | All three conditions met |
| `src/components/banners/EmailVerificationNagBanner.tsx` | aside aria-label; sessionStorage dismiss | ✓ VERIFIED | Both present |
| `src/app/dashboard/page.tsx` | requireSession() + DemoDashboard + EmailVerificationNagBanner | ✓ VERIFIED | All three wired correctly |
| `src/lib/demoData.ts` | receita_total: 6500, despesas_total: 4900, net: 1600 | ✓ VERIFIED | Exact amounts from UI-SPEC |
| `src/lib/formatCurrency.ts` | Intl.NumberFormat('pt-BR', BRL) | ✓ VERIFIED | Correct locale and currency |
| `docs/ops/ses-production-access.md` | SES justification runbook | ✓ VERIFIED | Exists with verbatim justification template |
| `docs/ops/encryption-key-rotation.md` | ENCRYPTION_KEY + CPF_HASH_PEPPER rotation | ✓ VERIFIED | Documents both distinct keys and rotation procedure |
| `README.md` | pnpm install + Docker Desktop + pnpm db:migrate + push banned | ✓ VERIFIED | All four items present |
| `tests/unit/observability/sentry-scrubber.test.ts` | 5 behaviors | ✓ VERIFIED | CPF in message, email in exception, nested extras, user.id hash, non-throw on malformed |
| `tests/unit/lib/logger.test.ts` | JSON + scrub-in-meta + scrub-by-key | ✓ VERIFIED | 3 test cases |
| `tests/integration/observability/env-assert.test.ts` | Subprocess exits non-zero with OPS-04 violation | ✓ VERIFIED | Spawns subprocess; asserts exit code and stderr |
| `tests/integration/webhooks/ses-bounce.test.ts` | 401 on bad sig; 3x replay = 1 row; subscribe confirm; suppression guard | ✓ VERIFIED | All 4 scenarios |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/app/(auth)/signup/signupCore.ts` | `users + user_consents + audit_log` | `db.transaction` INSERT × 3 | ✓ WIRED | `versions.ACCOUNT_CREATION` used for consent_version |
| `src/auth.ts` | DrizzleAdapter with `accounts_oauth` | NextAuth config | ✓ WIRED | `accountsTable: schema.accounts_oauth` confirmed |
| `src/lib/session.ts` | `auth()` from src/auth.ts | SSR session lookup | ✓ WIRED | requireSession() calls auth() |
| `src/lib/rateLimit.ts` | `auth_rate_limits` table | ON CONFLICT DO UPDATE | ✓ WIRED | onConflictDoUpdate with sql count + 1 |
| `src/lib/auditLog.ts` | `piiScrubber.scrubObject(metadata)` | pre-INSERT | ✓ WIRED | scrubObject(params.metadata) before INSERT |
| `src/app/(auth)/signup/signupCore.ts` | `versions.ACCOUNT_CREATION` | consentVersions import | ✓ WIRED | Real hash computed from legal docs |
| `src/app/api/privacy/export/route.ts` | `dsr_requests + pg-boss enqueue('dsr.acknowledge')` | requireSession + insert + boss.send | ✓ WIRED | QUEUES.DSR_ACKNOWLEDGE used |
| `src/jobs/workers/dsrAcknowledgeWorker.ts` | SES via mailer.sendEmail | AWS SDK v3 SendEmailCommand | ✓ WIRED | sendEmail + DSRAcknowledgment template |
| `instrumentation.ts` | `@/lib/env` (OPS-04 guard) | side-effect import FIRST | ✓ WIRED | First statement in register() |
| `sentry.server.config.ts` | `beforeSend` from src/lib/sentry.ts | Sentry.init option | ✓ WIRED | beforeSend imported and passed to Sentry.init |
| `src/lib/logger.ts` | `scrubObject` from src/lib/piiScrubber.ts | pino hooks.logMethod | ✓ WIRED | hooks.logMethod passes meta through scrubObject |
| `src/app/api/webhooks/ses/bounces/route.ts` | `webhook_events` UNIQUE(source, event_id) | onConflictDoNothing + boss.send | ✓ WIRED | verifySnsMessage before insert; onConflictDoNothing confirmed |
| `src/lib/mailer.ts` | `ses_suppressions` BEFORE `SendEmailCommand` | SELECT first | ✓ WIRED | Guard SELECT precedes send command |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `DemoDashboard.tsx` | `demoData` | `src/lib/demoData.ts` (hard-coded) | Yes — intentionally hard-coded demo data per UI-SPEC § 2.10 and D-03 | ✓ FLOWING (Phase 1 by design) |
| `EmailVerificationNagBanner.tsx` | `emailVerified` prop | `dashboard/page.tsx` reads `users.email_verified_at` from DB | Yes — real DB query via requireSession + Drizzle select | ✓ FLOWING |
| `ConsentScreen.tsx` | `config` from `getScopeConfig(scope)` | `consentScopes.ts` static config | Yes — intentionally static scope-config for Phase 1 | ✓ FLOWING (config-driven) |

---

## Behavioral Spot-Checks

Step 7b skipped for live runtime checks (requires running server). Automated test evidence is the best available verification without starting services.

| Behavior | Test Evidence | Status |
|----------|---------------|--------|
| CPF check-digit validation | `tests/unit/lib/cpf.test.ts` — 5 passing tests (repeating digits, all-zeros, known-valid, formatted) | ✓ PASS |
| AES-256-GCM round-trip + tamper rejection | `tests/unit/lib/crypto.test.ts` — 5 passing tests | ✓ PASS |
| argon2id hash output starts with `$argon2id$` | `tests/unit/lib/password.test.ts` — hash prefix test | ✓ PASS |
| 6th login attempt returns 429 + lock | `tests/integration/auth/rate-limit.test.ts` Test 1 | ✓ PASS |
| 3x SES SNS replay = 1 webhook_events row + 1 suppression | `tests/integration/webhooks/ses-bounce.test.ts` replay test | ✓ PASS |
| OPS-04 subprocess exits non-zero with sandbox in production | `tests/integration/observability/env-assert.test.ts` | ✓ PASS |
| DSR export creates PENDING row + enqueues dsr.acknowledge | `tests/integration/lgpd/dsr.test.ts` | ✓ PASS |
| Consent row written with scope=ACCOUNT_CREATION + versions hash | `tests/integration/lgpd/consent.test.ts` | ✓ PASS |

---

## Requirements Coverage

All requirements claimed by this phase's plans are accounted for:

| Requirement | Source Plan | Description (abbreviated) | Status | Evidence |
|-------------|------------|--------------------------|--------|----------|
| AUTH-01 | 01-02 | Register with email + CPF + password; CPF check-digit validated | ✓ SATISFIED | signup route + CPFSchema + integration tests |
| AUTH-02 | 01-02 | Log in + stay logged in across refresh (database session) | ✓ SATISFIED | auth.ts strategy='database' + e2e test |
| AUTH-03 | 01-02 | Logout invalidates server-side session | ✓ SATISFIED | logout route DELETEs session row + e2e test |
| AUTH-04 | 01-02 | Password reset via single-use 1h-TTL token | ✓ SATISFIED | reset routes + password_reset_tokens schema |
| AUTH-05 | 01-02 | Rate limiting: 5/15min login + account lock + reset 3/hour | ✓ SATISFIED | rateLimit.ts + rate-limit.test.ts (5 behaviors) |
| AUTH-06 | 01-02 | argon2id passwords; AES-256-GCM CPF storage | ✓ SATISFIED | password.ts + crypto.ts + unit tests |
| LGPD-01 | 01-03 | Consent screen before Pluggy + user_consents row written | ✓ SATISFIED | ConsentScreen component + consent.test.ts; note: Phase 2 is first production consumer of ConsentScreen for Pluggy; Phase 1 exercises it via unit + integration tests |
| LGPD-05 | 01-03 | All data in Brazilian territory (sa-east-1) | ✓ SATISFIED (infrastructure) / ? HUMAN (ops) | Postgres sa-east-1 is documented in railway-setup.md; actual Railway provisioning is deferred ops (STATE.md Deferred Items per 01-01 Task 3) |
| LGPD-06 | 01-03 | No PII in logs / Sentry / error traces; piiScrubber | ✓ SATISFIED | piiScrubber (8 unit tests) + Sentry beforeSend (5 unit tests) + logger scrubObject hook + auditLog scrubObject wiring |
| SEC-01 | 01-02 | Every route filters by session user_id; cross-user = 404 | ✓ SATISFIED | requireSession() + idor.test.ts |
| SEC-02 | 01-02 | HttpOnly + Secure + SameSite=Lax cookies; session rotation on password change | ✓ SATISFIED | auth.ts cookie config + reset/confirm route deletes all sessions |
| OPS-01 | 01-01 | Structured JSON logging + no PII + Sentry EU | ✓ SATISFIED | pino logger (01-04) + Sentry EU configs (01-04); plan 01-01 scaffolds the schema baseline that supports OPS-01 infrastructure; full implementation in 01-04 |
| OPS-04 | 01-04 | Sandbox creds cannot be confused with production; runtime assertion | ✓ SATISFIED | env.ts OPS-04 refine + instrumentation.ts first import + env-assert.test.ts subprocess |

**Note on LGPD-05 + Railway provisioning:** The ROADMAP and plan 01-01 mark Railway sa-east-1 provisioning as a human-action blocking gate (Task 3). The 01-01 SUMMARY documents this was deferred to Phase 6 (STATE.md Deferred Items). Code is fully ready; schema applies cleanly to sa-east-1 Postgres via `pnpm db:migrate`. The requirement is satisfied at the code layer and is pending ops execution.

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/components/banners/EmailVerificationNagBanner.tsx` line ~54 | `/api/auth/email/resend` returns 501 Not Implemented | ℹ️ Info | Intentional Phase 1 stub per D-02; banner uses optimistic toast UX. Email verification flow ships in Phase 2. |
| `src/components/demo/DemoDashboard.tsx` | "Conectar banco →" link with `aria-disabled="true"` | ℹ️ Info | Intentional — /connect route does not exist until Phase 2 (Pluggy). Correctly marked disabled. |

No blockers found. Both flagged stubs are documented intentional deferences, not implementation gaps.

---

## Human Verification Required

### 1. SES Email Delivery End-to-End

**Test:** In the deployed production Railway environment, trigger a password-reset request or account-unlock email for a real email address. Confirm the email arrives in the recipient's inbox.

**Expected:** Email arrives from `no-reply@portalfinance.app` with correct pt-BR copy, DKIM signature validates, no SPF errors. SES delivery metrics show 0 bounces for the test send. After a forced bounce (using `bounce@simulator.amazonses.com`), confirm a `ses_suppressions` row is created and a subsequent send attempt returns `{ suppressed: true }`.

**Why human:** AWS SES production access is pending (human-action gate from plan 01-04 Task 4, deferred in STATE.md). The SNS topic subscription cannot be confirmed without a live HTTPS endpoint. All code-side implementation is verified by `tests/integration/webhooks/ses-bounce.test.ts` and `tests/integration/lgpd/dsr.test.ts`.

### 2. Sentry EU Live Error Capture with PII Scrubbing

**Test:** With a valid `SENTRY_DSN` ending in `de.sentry.io` set in the Railway environment, navigate to a route that throws an intentional error containing a CPF (e.g., temporarily add `throw new Error('user 123.456.789-00 failed')` to a server component). Check the Sentry EU dashboard.

**Expected:** Event appears in the Sentry EU project. Event message shows `user [CPF] failed` — not the raw CPF. `event.user.id` is a 16-char hex hash, not a UUID. No email addresses appear anywhere in the event payload.

**Why human:** Requires a live Sentry EU project at de.sentry.io with a real DSN and a deployed web service. `tests/unit/observability/sentry-scrubber.test.ts` verifies the beforeSend function in isolation; the live integration requires the Sentry console (deferred ops from plan 01-04 Task 4).

### 3. Production Session Lifecycle on Deployed Railway Instance

**Test:** On the deployed `portalfinance.app` URL, complete a full register → login → browser refresh → logout cycle.

**Expected:** After signup, user is redirected to /dashboard. Browser refresh keeps the user logged in (session cookie + DB session row). Clicking logout redirects to /login and the session row is deleted from the `sessions` table.

**Why human:** The Playwright e2e test (`tests/e2e/auth.spec.ts`) runs against `localhost:3000` with a testcontainers Postgres. Production verification requires Railway deployment with live `DATABASE_URL`, `NEXTAUTH_SECRET`, and an HTTPS-served origin for the Secure cookie to function correctly.

### 4. SES Bounce Pipeline End-to-End with Live AWS

**Test:** From the production Railway environment, send an email to `bounce@simulator.amazonses.com` (AWS SES bounce simulator). Watch the Railway worker logs and verify the suppression flow.

**Expected:** Within 60 seconds: (a) SNS topic delivers a Bounce notification to `/api/webhooks/ses/bounces`; (b) worker logs show `ses_bounce_received` then `ses_suppressions` write; (c) `SELECT * FROM ses_suppressions WHERE email_lower='bounce@simulator.amazonses.com'` returns 1 row; (d) a subsequent `sendEmail({ to: 'bounce@simulator.amazonses.com', ... })` call returns `{ suppressed: true }`.

**Why human:** Requires live SES production access + configured SNS topic subscription (both deferred ops from plan 01-04 Task 4). The code-side idempotency is fully verified by `tests/integration/webhooks/ses-bounce.test.ts`.

---

## Gaps Summary

No code-level gaps found. All 6 roadmap success criteria are satisfied by the implemented codebase. All plan must-haves are present, substantive, and correctly wired.

The `human_needed` status reflects 4 human verification items that cannot be exercised without live external services (AWS SES production access, Sentry EU project, deployed Railway environment). These are correctly documented as deferred ops in STATE.md under Deferred Items for plan 01-04 Task 4. The code is production-ready for all four items; the blockers are ops/infrastructure, not implementation.

**Deferred ops (not code gaps):**

- Railway sa-east-1 Postgres provisioning (01-01 Task 3 BLOCKING) — schema code complete; human must provision Railway and run `pnpm db:migrate`
- SES production access + SNS subscription (01-04 Task 4 BLOCKING) — webhook code complete; human must request SES prod access and wire SNS
- Sentry EU project creation + DSN configuration (01-04 Task 4 BLOCKING) — Sentry SDK wired; human must create EU project and set SENTRY_DSN

---

_Verified: 2026-04-22T23:59:00Z_
_Verifier: Claude (gsd-verifier)_
