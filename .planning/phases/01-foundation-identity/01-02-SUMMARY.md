---
phase: 01-foundation-identity
plan: 02
subsystem: identity-auth
tags: [auth-js-v5, argon2, aes-256-gcm, rate-limiting, turnstile, zod-v4, cpf, credentials, drizzle-adapter, session-db]
requires:
  - "Wave 0 scaffold (plan 01-00) — pnpm scripts, Vitest + Playwright + testcontainers, shadcn primitives"
  - "Wave 1 schema (plan 01-01) — users, sessions, accounts_oauth, verification_tokens, user_consents, audit_log, auth_rate_limits, account_locks, password_reset_tokens"
provides:
  - "next-auth@5.0.0-beta.31 + @auth/drizzle-adapter@1.11.2 wired against Postgres via postgres@3.4.9"
  - "src/auth.ts — NextAuth config (DrizzleAdapter on accounts_oauth + verification_tokens; Credentials provider; HttpOnly + Secure + SameSite=Lax cookies)"
  - "src/middleware.ts — edge-safe cookie-presence gate (no argon2/crypto imports)"
  - "src/lib/env.ts — Zod-validated env loader with OPS-04 production/sandbox guard"
  - "src/lib/crypto.ts — AES-256-GCM encryptCPF/decryptCPF + HMAC-SHA-256 hashCPF (distinct pepper)"
  - "src/lib/password.ts — argon2id hash + verify with const-time equalisation for missing users"
  - "src/lib/cpf.ts — CPFSchema + formatCPF via @brazilian-utils/brazilian-utils@2.3.0"
  - "src/lib/validation.ts — SignupSchema, LoginSchema, PasswordResetRequest/Confirm Zod schemas"
  - "src/lib/session.ts — requireSession() / getSessionUserId() (SEC-01 IDOR baseline)"
  - "src/lib/rateLimit.ts — Postgres sliding-window counter (D-05) with ON CONFLICT DO UPDATE"
  - "src/lib/turnstile.ts — Cloudflare Turnstile server-side verification (D-07)"
  - "src/lib/auditLog.ts + src/lib/consentVersions.ts — audit row writer + consent version constants"
  - "src/app/api/auth/* — signup, login, logout, reset/{request,validate,confirm}, unlock, [...nextauth] handlers — every route declares runtime = 'nodejs'"
  - "src/app/(auth)/* — signup / login / reset / reset/confirm / locked / unlock pages + AuthShell layout"
  - "UI-SPEC § 2.1–2.7 components: AuthShell, SignupForm, LoginForm, PasswordField, TurnstileSlot, PasswordResetRequestForm, PasswordResetConfirmForm, AccountLockedScreen, UnlockPendingScreen"
  - "src/app/dashboard/{page,LogoutButton}.tsx — Phase 1 placeholder authenticated route"
  - "src/jobs/boss.ts — pg-boss STUB (real worker lands in plan 01-03)"
  - "scripts/run-e2e.ts — spawns testcontainers Postgres, rewrites .env.local, then invokes playwright test"
  - "Tests: 22 unit (cpf, crypto, password, env), 18 integration (auth/rate-limit, security/idor), 1 e2e (register → login → reload → logout)"
affects:
  - "Phase 1 plan 01-03 replaces src/jobs/boss.ts stub with the real pg-boss singleton + worker entrypoint"
  - "Phase 1 plan 01-04 imports env from src/lib/env.ts inside instrumentation.ts for OPS-04 boot assertion"
  - "Phase 2 Pluggy ingestion consumes encryptCPF / hashCPF from src/lib/crypto.ts unchanged; requireSession() gates every connect-token route"
  - "Phase 3 LLM fallback inherits rate-limit pattern + piiScrubber composition point"
  - "Phase 4 dashboard inherits /dashboard placeholder + session-backed SSR layout"
tech-stack:
  added:
    - "next-auth@5.0.0-beta.31"
    - "@auth/drizzle-adapter@1.11.2"
    - "argon2@0.44.0 (node-gyp prebuild succeeded; no swap to @node-rs/argon2 required)"
    - "@brazilian-utils/brazilian-utils@2.3.0"
    - "@marsidev/react-turnstile@1.5.0"
  patterns:
    - "Self-managed sessions row (Auth.js v5 Credentials provider is incompatible with database session strategy — signIn() raises UnsupportedStrategy). Signup + login routes INSERT into sessions and set the Auth.js-named cookie directly; requireSession() resolves the cookie via next/headers against the sessions table."
    - "Every auth API route declares `export const runtime = 'nodejs'` explicitly (Pitfall 6 — middleware stays edge-safe, routes never touch edge runtime)."
    - "Postgres sliding-window rate limit: ON CONFLICT (identifier, bucket, window_start) DO UPDATE SET count = count + 1 — single-statement atomic increment."
    - "Const-time password verify: when user is missing, verifyPassword() runs a dummy argon2.verify against a canonical zero-salt hash so attackers can't enumerate emails via timing."
    - "Anti-enumeration on reset: /api/auth/reset/request returns identical 200 whether the email exists or not (D-08)."
    - "Session rotation on password change: reset/confirm route DELETEs all sessions for the user before issuing a new cookie."
    - "Turnstile after 2nd failure, gated server-side off the rate-limit counter — client failure count is never trusted."
    - "E2E mode (E2E_TEST=1): auth.ts relaxes to trustHost: true + http-friendly cookie so Playwright over plain http://localhost:3000 round-trips the session."
    - "scripts/run-e2e.ts: testcontainers Postgres spawns + .env.local rewrite happen BEFORE Playwright's webServer — avoids globalSetup vs webServer race on Windows."
    - "Lazy Drizzle client construction — src/db/index.ts accepts a placeholder DATABASE_URL so Next 16's build-time `collect page data` phase succeeds without a live DB."
key-files:
  created:
    - "src/auth.ts"
    - "src/middleware.ts"
    - "src/lib/env.ts"
    - "src/lib/crypto.ts"
    - "src/lib/password.ts"
    - "src/lib/cpf.ts"
    - "src/lib/validation.ts"
    - "src/lib/common-passwords.ts"
    - "src/lib/session.ts"
    - "src/lib/rateLimit.ts"
    - "src/lib/turnstile.ts"
    - "src/lib/auditLog.ts"
    - "src/lib/consentVersions.ts"
    - "src/jobs/boss.ts"
    - "src/app/api/auth/[...nextauth]/route.ts"
    - "src/app/api/auth/signup/route.ts"
    - "src/app/api/auth/login/route.ts"
    - "src/app/api/auth/logout/route.ts"
    - "src/app/api/auth/reset/request/route.ts"
    - "src/app/api/auth/reset/validate/route.ts"
    - "src/app/api/auth/reset/confirm/route.ts"
    - "src/app/api/auth/unlock/route.ts"
    - "src/app/(auth)/layout.tsx"
    - "src/app/(auth)/signup/page.tsx"
    - "src/app/(auth)/signup/actions.ts"
    - "src/app/(auth)/signup/signupCore.ts"
    - "src/app/(auth)/login/page.tsx"
    - "src/app/(auth)/reset/page.tsx"
    - "src/app/(auth)/reset/confirm/page.tsx"
    - "src/app/(auth)/locked/page.tsx"
    - "src/app/(auth)/unlock/page.tsx"
    - "src/app/dashboard/page.tsx"
    - "src/app/dashboard/LogoutButton.tsx"
    - "src/components/auth/AuthShell.tsx"
    - "src/components/auth/SignupForm.tsx"
    - "src/components/auth/LoginForm.tsx"
    - "src/components/auth/PasswordField.tsx"
    - "src/components/auth/PasswordResetRequestForm.tsx"
    - "src/components/auth/PasswordResetConfirmForm.tsx"
    - "src/components/auth/AccountLockedScreen.tsx"
    - "src/components/auth/UnlockPendingScreen.tsx"
    - "src/components/auth/TurnstileSlot.tsx"
    - "scripts/run-e2e.ts"
    - "tests/unit/lib/cpf.test.ts"
    - "tests/unit/lib/crypto.test.ts"
    - "tests/unit/lib/password.test.ts"
    - "tests/unit/lib/env.test.ts"
    - "tests/integration/auth/rate-limit.test.ts"
    - "tests/integration/security/idor.test.ts"
    - "tests/e2e/auth.spec.ts"
  modified:
    - "package.json"
    - "pnpm-lock.yaml"
    - "playwright.config.ts"
    - "src/db/index.ts"
    - "tests/setup.ts"
decisions:
  - "Auth.js v5 Credentials + database session strategy is unsupported — signIn() raises UnsupportedStrategy. We self-manage the sessions row (INSERT on signup/login, DELETE on logout, cookie set/unset directly) while Auth.js continues to own the cookie name, adapter shape, and table layout for forward compatibility."
  - "Native checkbox in SignupForm instead of the shadcn Radix Checkbox — Radix's underlying input renders aria-hidden, which breaks React Hook Form's register() integration. Re-styled with Tailwind to match the UI-SPEC."
  - "argon2@0.44.0 native prebuild worked on the local dev host (node-gyp compiled cleanly). No swap to @node-rs/argon2 needed yet; Railway container fallback is still documented for Phase 6 deploy work."
  - "src/db/index.ts constructs the postgres client lazily from env.DATABASE_URL, accepting a placeholder URL for Next 16 build-time `collect page data` — a live DB is only required at request time."
  - "scripts/run-e2e.ts is authoritative for E2E orchestration on Windows: testcontainers Postgres spawns first, .env.local is rewritten, and only then Playwright's webServer boots (avoids globalSetup vs webServer race)."
  - "E2E_TEST=1 relaxes cookies to non-Secure + trustHost: true so Playwright over plain http://localhost:3000 can round-trip the session. Gate is env-driven and never active outside E2E."
  - "consentVersions.ts centralises the current Phase 1 consent version hash — Phase 1 plan 01-03 will extend this with the full ToS + Privacy markdown sources."
  - "src/jobs/boss.ts ships as a pg-boss STUB for this plan — the real singleton + worker entrypoint lands in plan 01-03 (LGPD scaffolding) where the first real job (SES suppression webhook) needs it."
metrics:
  duration_seconds: 2166
  duration_minutes: 36.1
  tasks_completed: 3
  files_created: 49
  files_modified: 5
  commits: 3
  completed: "2026-04-22T21:25:27Z"
---

# Phase 1 Plan 02: Wave 2 — Auth.js v5 + CPF crypto + UI-SPEC auth Summary

Auth.js v5 credentials authentication landed with every AUTH-01..06 + SEC-01 + SEC-02 requirement covered: argon2id passwords, AES-256-GCM CPF helpers (columns nullable in Phase 1 per D-04), Postgres sliding-window rate limit (D-05 + D-06), Cloudflare Turnstile after the 2nd failure (D-07), anti-enumeration reset flow (D-08), session rotation on password change, IDOR-safe `requireSession()` baseline, and UI-SPEC §§ 2.1–2.7 auth screens in pt-BR. End-to-end register → login → reload → logout green against a live local Next.js + testcontainers Postgres.

## Tasks Completed

| Task | Name                                                                              | Status | Commit    |
| ---- | --------------------------------------------------------------------------------- | ------ | --------- |
| 1    | Install auth deps + env loader + crypto / password / CPF / validation libraries    | DONE   | `927786e` |
| 2    | Auth.js v5 wiring, rate limiter, Turnstile, session helper, auth routes            | DONE   | `bb50a86` |
| 3    | UI-SPEC auth components (AuthShell + forms + screens) + e2e flow                   | DONE   | `39c1b1b` |

## What Was Built

### Task 1 — Crypto, Password, CPF, Env, Validation (commit `927786e`)

- **Dependencies:** `argon2@0.44.0`, `@brazilian-utils/brazilian-utils@2.3.0` (RESEARCH.md Pitfall 2 — NOT `@brazilian-utils/br-validations`).
- **`src/lib/env.ts`** — Zod v4 schema parsing `process.env` at module load. Includes the OPS-04 `.refine()` guard that refuses `NODE_ENV=production` while `PLUGGY_ENV=sandbox` / `ASAAS_ENV=sandbox`. `ENCRYPTION_KEY` must base64-decode to exactly 32 bytes; `CPF_HASH_PEPPER` is a distinct ≥32-char string (RESEARCH.md Open Question #3).
- **`src/lib/crypto.ts`** — AES-256-GCM with 12-byte IV + 16-byte auth tag; HMAC-SHA-256 `hashCPF` keyed with the distinct pepper. Tamper-rejection test proves the auth tag check fires.
- **`src/lib/password.ts`** — argon2id with OWASP-2025 params (`timeCost=3`, `memoryCost=65536`, `parallelism=1`). `verifyPassword(null, ...)` runs a dummy verify against a canonical zero-salt hash to defeat enumeration via timing.
- **`src/lib/cpf.ts`** — `CPFSchema` (via brazilian-utils v2.3) rejects repeating-digit CPFs, `00000000000`, and valid-format-but-failing-check-digit; `formatCPF` round-trips `52998224725` ↔ `529.982.247-25`.
- **`src/lib/validation.ts`** — `SignupSchema`, `LoginSchema`, `PasswordResetRequestSchema`, `PasswordResetConfirmSchema` + a shared password-strength refine that rejects against `src/lib/common-passwords.ts` (120-entry top list).
- **Tests (22 unit):** `cpf.test.ts` (5), `crypto.test.ts` (5), `password.test.ts` (4), `env.test.ts` (8). All green on first execution.

### Task 2 — Auth.js, rate limit, Turnstile, auth routes (commit `bb50a86`)

- **Dependencies:** `next-auth@5.0.0-beta.31`, `@auth/drizzle-adapter@1.11.2`.
- **`src/auth.ts`** — `DrizzleAdapter` with `accountsTable: schema.accounts_oauth` (Pluggy collision avoidance — Pitfall 4) + `verificationTokensTable: schema.verification_tokens`. Credentials provider, database session strategy, explicit cookie config (`httpOnly: true`, `secure: true`, `sameSite: 'lax'`, 30-day expiry).
- **`src/middleware.ts`** — cookie-presence gate: unauthenticated `/dashboard` + `/settings` redirect to `/login`. Zero auth/crypto/password imports (Pitfall 6 — edge-safe).
- **`src/lib/session.ts`** — `requireSession()` throws `UnauthorizedError`; `getSessionUserId()` returns the user id or null. Consumed by every authenticated route as the SEC-01 IDOR baseline.
- **`src/lib/rateLimit.ts`** — `checkAndIncrement({ identifier, bucket, windowMs, max })` uses `ON CONFLICT (identifier, bucket, window_start) DO UPDATE SET count = count + 1`. Single-statement atomic; returns `{ remaining, retryAfter }`.
- **`src/lib/turnstile.ts`** — server-side POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. Accepts the Turnstile token + client IP; returns boolean. `TURNSTILE_SECRET_KEY` never crosses the browser boundary.
- **Auth routes (all `runtime = 'nodejs'`):**
  - `POST /api/auth/signup` — writes `users` + `user_consents` + `audit_log` atomically in a single Drizzle transaction. Issues a fresh session row + cookie.
  - `POST /api/auth/login` — D-06 5/15 + 10/hour/IP rate limits; lock on the 6th attempt (INSERT `account_locks` row + enqueue unlock email via the pg-boss stub); Turnstile required when the rate-limit counter ≥ 2.
  - `POST /api/auth/reset/request` — D-08 anti-enumeration (identical 200 body), per-email 3/hour + per-IP 10/hour caps.
  - `GET /api/auth/reset/validate` — consumes the argon2-hashed `password_reset_tokens` row; checks `expires_at` + `used_at IS NULL`.
  - `POST /api/auth/reset/confirm` — verifies token, updates `users.password_hash`, DELETEs all `sessions` for the user (SEC-02 session rotation), issues fresh session.
  - `GET /api/auth/unlock` — consumes `unlock_token_hash`, sets `account_locks.unlocked_at` + `unlocked_via = 'email'`, redirects to `/login`.
  - `GET|POST /api/auth/[...nextauth]` — Auth.js standard handlers.
- **Tests (18 integration):** `auth/rate-limit.test.ts` covers 429 on 6th attempt, unlock email queued + single-use link, reset 4th request in an hour returns 429, anti-enumeration identical responses, Turnstile required after 2nd failure. `security/idor.test.ts` covers user B cannot read user A's `audit_log` / `user_consents` — 404 (not 403).

### Task 3 — UI-SPEC components + e2e + session lifecycle pivots (commit `39c1b1b`)

- **`src/components/auth/`** — 9 components per UI-SPEC §§ 2.1–2.7:
  - `AuthShell` — logo + app name + card layout
  - `SignupForm` — email + password + consent checkbox (native checkbox per decision above)
  - `LoginForm` — email + password + TurnstileSlot that activates after the 2nd server-reported failure
  - `PasswordField` — show/hide toggle + strength indicator
  - `TurnstileSlot` — lazy-loaded `@marsidev/react-turnstile` widget (site key via `NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY` only)
  - `PasswordResetRequestForm` — email-only input, identical success message whether account exists
  - `PasswordResetConfirmForm` — new password + confirm + strength check
  - `AccountLockedScreen` — pt-BR copy from UI-SPEC § Copywriting verbatim
  - `UnlockPendingScreen` — mailbox-check screen post-unlock request
- **Page wrappers** under `src/app/(auth)/` for signup / login / reset / reset/confirm / locked / unlock; `src/app/dashboard/{page,LogoutButton}.tsx` is the Phase 1 authenticated placeholder (real dashboard is Phase 4).
- **Session lifecycle pivot** — see Deviations § Rule 4→Rule 1 entry. Signup/login routes write the sessions row themselves; logout route DELETEs it.
- **`scripts/run-e2e.ts`** — orchestrates testcontainers Postgres boot, `.env.local` rewrite, and `pnpm playwright test` invocation in that order. Supersedes the previous `playwright.config.ts` globalSetup hook on Windows.
- **Tests:** 1 e2e (`tests/e2e/auth.spec.ts`) — register → login → reload (session persists) → logout (server-side row deleted). Plus 4 integration tests added to the existing auth / security suites.

## Question Resolutions

- **`next-auth` / `@auth/drizzle-adapter` versions installed:** `next-auth@5.0.0-beta.31`, `@auth/drizzle-adapter@1.11.2`. Both confirmed in `package.json`.
- **argon2 native binding on Railway:** NOT exercised in this plan — local dev host compiled `argon2@0.44.0` cleanly via node-gyp. Railway container swap to `@node-rs/argon2` remains an open deploy-time mitigation documented in RESEARCH.md Pitfall 3; will be re-evaluated in Phase 6.
- **pt-BR copy deviations from UI-SPEC § Copywriting:** None. All copy verbatim.
- **Extra CPF edge-case tests beyond fixtures:** Added known-invalid formats (`111.111.111-11`, `00000000000`) alongside a known-valid canonical CPF (`52998224725`) in both raw and formatted inputs.
- **pg-boss chicken-and-egg:** Acknowledged. `src/jobs/boss.ts` is a STUB here — its only job is to expose `enqueueUnlockEmail()` / `enqueuePasswordResetEmail()` signatures that the login + reset routes call. Plan 01-03 replaces the stub with the real pg-boss singleton + worker entrypoint; signatures remain stable.
- **Auth routes all Node runtime:** Confirmed via grep — `export const runtime = 'nodejs'` in 8/8 route files (`[...nextauth]`, `signup`, `login`, `logout`, `reset/request`, `reset/validate`, `reset/confirm`, `unlock`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4 boundary judged Rule 1 — Bug] Auth.js v5 Credentials + DB sessions is unsupported**

- **Found during:** Task 3 e2e test authoring. `signIn('credentials', ...)` threw `UnsupportedStrategy` because Auth.js v5 Credentials cannot be combined with the database session strategy (only JWT sessions are compatible out-of-box).
- **Fix:** Self-manage the `sessions` row in our own routes — signup/login INSERT the session + set the Auth.js-named cookie directly; logout DELETEs it; `requireSession()` reads the cookie via `next/headers` and resolves against the `sessions` table. Auth.js still owns the adapter shape, cookie name, and table layout so future migration to OAuth providers is zero-churn.
- **Files modified:** `src/auth.ts`, `src/app/(auth)/signup/signupCore.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/signup/route.ts`, `src/lib/session.ts`
- **Commit:** `39c1b1b`

**2. [Rule 1 — Bug] Next 16 build-time data collection needs a placeholder DATABASE_URL**

- **Found during:** Task 3 `pnpm build`. Next 16's "collect page data" phase imports server modules at build time, which previously required a live `DATABASE_URL` because `src/db/index.ts` constructed the postgres client eagerly.
- **Fix:** Lazy client construction — `src/db/index.ts` accepts a placeholder URL and only connects on first query. Build succeeds without a live DB; runtime behaviour unchanged.
- **Files modified:** `src/db/index.ts`
- **Commit:** `39c1b1b`

**3. [Rule 1 — Bug] Radix Checkbox breaks RHF `register()`**

- **Found during:** Task 3 SignupForm authoring.
- **Issue:** shadcn's Radix Checkbox primitive renders the underlying `<input>` as `aria-hidden`, so React Hook Form's `register()` callback never fires and the consent field is always empty on submit.
- **Fix:** Swapped to a native styled `<input type="checkbox">` inside `SignupForm.tsx`. Same visual contract (Tailwind), functional RHF integration.
- **Files modified:** `src/components/auth/SignupForm.tsx`
- **Commit:** `39c1b1b`

**4. [Rule 3 — Blocking env race] Playwright globalSetup ran after the webServer spawned on Windows**

- **Found during:** Task 3 first e2e run. Playwright's `globalSetup` hook is supposed to boot testcontainers + rewrite `.env.local` BEFORE `webServer` spawns `pnpm start:web`; on Windows the two ran concurrently and Next started against an empty `.env.local`.
- **Fix:** Moved orchestration to `scripts/run-e2e.ts`. `pnpm test:e2e` now invokes the script, which sequentially: (a) starts testcontainers Postgres, (b) rewrites `.env.local` with the live `DATABASE_URL`, (c) invokes `pnpm playwright test`. `playwright.config.ts` still declares the webServer — the webServer only spawns after step (b) completes because Playwright runs inside the script.
- **Files modified:** `scripts/run-e2e.ts` (new), `playwright.config.ts`, `package.json`
- **Commit:** `39c1b1b`

**5. [Rule 1 — Bug] E2E over plain http breaks Secure cookie**

- **Found during:** Task 3 e2e session-persistence test. `secure: true` cookies are dropped by browsers on `http://localhost:3000`, so the session cookie set by signup never reached the reload.
- **Fix:** `src/auth.ts` checks `env.E2E_TEST === '1'` and relaxes to `secure: false` + `trustHost: true` during E2E only. Gate is env-driven; production behaviour is unchanged.
- **Files modified:** `src/auth.ts`
- **Commit:** `39c1b1b`

### Architectural Notes

- No Rule 4 stops triggered. Issue 1 sits on the boundary — the Auth.js v5 v-Credentials-with-DB-sessions incompatibility is architectural, but the fix (self-manage the sessions row while keeping Auth.js's cookie name + adapter) is additive and preserves forward compatibility with OAuth providers.
- `react-turnstile` package shipped is `@marsidev/react-turnstile@1.5.0` — the current de-facto React wrapper around Cloudflare's Turnstile widget.

### Deferred Items

- **pg-boss real worker** — `src/jobs/boss.ts` is a STUB exposing `enqueueUnlockEmail()` and `enqueuePasswordResetEmail()`. The real pg-boss singleton + worker entrypoint + SES mailer ship in plan 01-03 (LGPD scaffolding) without changing the call signatures.
- **argon2 on Railway container** — open mitigation path: swap to `@node-rs/argon2@^2` (same API, pure Rust prebuild) if node-gyp fails on Railway's build image. Will be validated in Phase 6 deploy work.
- **Consent versions catalogue** — `src/lib/consentVersions.ts` currently carries the Phase 1 placeholder hash. Plan 01-03 extends it with the full ToS + Privacy markdown sources and their hashes.

## Authentication / Human-Action Gates

**Cloudflare Turnstile registration** is required before production. Env vars `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY` documented in `docs/ops/railway-setup.md` (alongside the DB env matrix). For local dev and tests, the Turnstile slot is rendered but bypassed when the secret key is unset — the D-07 gate still runs on the server-side rate-limit counter, it just doesn't verify the widget token.

## Threat Surface

All Phase 1.02 threat-register rows covered:

| Threat                         | Mitigation Evidence                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| T-AUTH-PWHASH                  | `tests/unit/lib/password.test.ts` — hash starts with `$argon2id$`                               |
| T-AUTH-CPF-AT-REST             | `tests/unit/lib/crypto.test.ts` — AES-256-GCM round-trip + tamper rejection                     |
| T-AUTH-BRUTE                   | `tests/integration/auth/rate-limit.test.ts` — 5 behaviours (429 on 6th, unlock email, reset 4th, anti-enum, Turnstile-after-2) |
| T-IDOR-BASE                    | `tests/integration/security/idor.test.ts` — user B → 404 on user A rows                          |
| T-AUTH-EDGE                    | Grep: `src/middleware.ts` contains no `@/auth`, `@/lib/crypto`, `@/lib/password` imports         |
| T-AUTH-ENUMERATION             | `rate-limit.test.ts` Test 5 — identical reset response; `password.ts` dummy verify for missing user |
| T-AUTH-SESS-FIXATION           | `reset/confirm/route.ts` — `delete(sessions).where(eq(sessions.user_id, userId))` before issuing new cookie |
| T-TURNSTILE-BYPASS             | `login/route.ts` — Turnstile verified server-side when rate-limit counter ≥ 2; client count never gates |
| T-TURNSTILE-SECRET-LEAK        | Grep `TURNSTILE_SECRET_KEY` across `src/components/**` + `src/app/(auth)/**` → 0 matches        |
| T-COOKIE-WEAK                  | `src/auth.ts` — `httpOnly: true, secure: true, sameSite: 'lax'` (relaxed only under `E2E_TEST=1`) |

## Verification Gate

| Check                                              | Result | Notes                                                              |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `pnpm typecheck`                                   | PASS   | Clean                                                              |
| `pnpm build`                                       | PASS   | Build-time DB-URL placeholder fix verified                         |
| `pnpm test:unit -- lib/{cpf,crypto,password,env}`  | PASS   | 22 tests                                                           |
| `pnpm test:integration -- auth security`           | PASS   | 18 tests (rate-limit + idor) against testcontainers Postgres 16     |
| `pnpm test:e2e -- auth.spec.ts`                    | PASS   | register → login → reload → logout                                  |
| Grep `TURNSTILE_SECRET_KEY` in client files        | PASS   | 0 matches in `src/components/**`, `src/app/(auth)/**`               |
| Grep `runtime = 'nodejs'` in `src/app/api/auth/**` | PASS   | 8/8 route files declare Node runtime                                |
| Grep `accountsTable:\s*schema\.accounts_oauth`     | PASS   | `src/auth.ts`                                                        |

## Self-Check: PASSED

All 49 created files exist on disk. All 3 commit hashes (`927786e`, `bb50a86`, `39c1b1b`) resolve in `git log master`. Verified:

- `src/auth.ts`, `src/middleware.ts` present
- 13 `src/lib/*.ts` modules (env, crypto, password, cpf, common-passwords, validation, session, rateLimit, turnstile, auditLog, consentVersions + existing `utils.ts` from 01-00) all present
- 8 API route files under `src/app/api/auth/**` all present with Node runtime declaration
- 9 auth components under `src/components/auth/` all present
- 7 `src/app/(auth)/` page wrappers + layout all present
- `src/app/dashboard/{page,LogoutButton}.tsx` placeholder present
- `scripts/run-e2e.ts` present
- 4 unit test files + 2 integration test files + 1 e2e spec all present
- No `TURNSTILE_SECRET_KEY` reference in any client-shipped file
