# Phase 1: Foundation & Identity — Research

**Researched:** 2026-04-22
**Domain:** Railway `sa-east-1` deployment topology + Next.js 16 App Router + Drizzle ORM baseline + Auth.js v5 credentials + LGPD scaffolding + Sentry EU observability (no bank data yet)
**Confidence:** HIGH for package-registry verification, stack patterns, and LGPD scaffolding; MEDIUM for Railway region availability at creation time (requires runtime verification by a human in plan 01-01)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sign-up & First-Run UX**
- **D-01:** Sign-up is a single-page form — email + password + consent checkbox on one screen. Inline client-side validation. No multi-step wizard.
- **D-02:** Email verification is deferred — sign-in works immediately after sign-up; a persistent nag banner requests verification. Email verification becomes mandatory before connecting the first Pluggy item (Phase 2) and before paid subscription checkout (Phase 5).
- **D-03:** First post-signup screen is a demo dashboard populated with illustrative sample data ("this is what yours will look like — connect your bank to see real numbers.")
- **D-04:** **CPF is NOT collected at sign-up.** CPF is collected + validated + AES-256-GCM encrypted at the first bank-connect step (Phase 2), on the same consent screen that gates Pluggy Connect.
  - AUTH-01 wording must be updated by the planner.
  - `users.cpf_hash` and `users.cpf_enc` are nullable in Phase 1; NOT-NULL is introduced by the Phase 2 migration.

**Authentication & Rate Limiting**
- **D-05:** Rate-limit counters and lockout state are stored in Postgres. A dedicated `auth_rate_limits` table keyed on `(identifier, bucket_window)` with a pg-boss cron sweeper for expired rows. No Redis / Upstash in Phase 1.
- **D-06:** Login failure policy = 5 failures per 15-minute sliding window → 15-minute lockout + unlock email. Successful login resets the counter. Unlock email contains a single-use, time-limited link.
- **D-07:** CAPTCHA is shown after the 2nd failed login attempt. Vendor: **Cloudflare Turnstile** (invisible / managed challenge).
- **D-08:** Password-reset rate limit = 3 requests / hour / email + stricter per-IP cap (10 / hour / IP). Duplicate in-window requests are silent-ignored to prevent account enumeration.

**Email / Transactional Provider**
- **D-09:** AWS SES `sa-east-1` is the transactional email provider for Phase 1 and forward.
- **D-10:** Email templates authored as React Email components in-repo (`src/emails/*.tsx`), rendered via `@react-email/render`.
- **D-11:** Sender address = `no-reply@portalfinance.app` (apex). SPF + DKIM (SES-managed) + DMARC on the apex.
- **D-12:** Request SES production access during plan `01-04` — AWS review is 24–48 h.
- **D-13:** DMARC starts at `p=none` with `rua` aggregate reporting. Upgrade to `quarantine`/`reject` in Phase 6.
- **D-14:** Use the **AWS SDK v3 SES client** (`@aws-sdk/client-ses`). Not SMTP / Nodemailer.
- **D-15:** Bounce / complaint handling = SNS topic → webhook → `webhook_events` + pg-boss worker. Worker writes suppression rows.

**LGPD Consent, DSR, and PII**
- **D-16:** Signup-time consent writes a `user_consents` row with `scope='ACCOUNT_CREATION'`, `action='GRANTED'`, IP, UA, timestamp. Reusable `ConsentScreen` component is exercised by a unit test.
- **D-17:** DSR skeleton = `dsr_requests` schema + `/api/privacy/export` and `/api/privacy/delete` stubs that create a row, enqueue a pg-boss job, and send an SES acknowledgment. Worker writes `status='PENDING'` only; full execution ships in Phase 6. Acknowledgment mentions the 15-day statutory window.
- **D-18:** `piiScrubber` is one utility with pluggable rules (`lib/piiScrubber.ts`, `Rule<T>` pattern). Initial rules: CPF regex, Brazilian-name PIX patterns, email, phone, account numbers, token-like strings. Consumed by Sentry `beforeSend` and the structured-log wrapper in Phase 1; LLM prompt builder in Phase 3.
- **D-19:** `audit_log` coverage in Phase 1 = auth events only: `signup`, `login_success`, `login_failure`, `logout`, `password_reset_requested`, `password_reset_completed`, `account_locked`, `account_unlocked`, `consent_granted`, `consent_revoked`.

### Claude's Discretion

- **Session strategy:** Database-backed sessions via `@auth/drizzle-adapter` (required by AUTH-03 server-side invalidation).
- **Encryption key management:** Single master key from Railway env var (`ENCRYPTION_KEY`) in Phase 1, with a documented rotation procedure. Revisit envelope / KMS in Phase 6.
- **Plan sequencing:** Keep ROADMAP order (01-01 infra → 01-02 auth → 01-03 LGPD → 01-04 observability), but Sentry SDK install + `beforeSend` scrubber wiring happens as the first task of 01-01.
- **Runtime sandbox/prod assertion (OPS-04):** `lib/env.ts` validates all env vars with Zod at boot; throws if `NODE_ENV='production'` and any of `PLUGGY_ENV`, `ASAAS_ENV`, `SENTRY_ENV` is `'sandbox'` / `'test'` / undefined. Boot fails fast before the HTTP server accepts traffic.
- **Subscription tier default:** `subscription_tier` defaults to `'paid'` on INSERT until Phase 5 flips it.
- **Password strength:** Zod enforces min 10 chars, ≥ 1 letter + 1 number, disallows top-1000 common passwords. No must-have-special-char rule.

### Deferred Ideas (OUT OF SCOPE)

- Social authentication (Google / Apple) — tracked as v1.x `AUTH-EXT-01`.
- Multi-key envelope encryption / KMS — Phase 6.
- DMARC quarantine / reject — Phase 6.
- Broader `audit_log` coverage — Phases 2–6 extend the catalogue.
- Encryption key rotation tooling — Phase 6.
- Password-strength meter UI — Phase 4 polish.
- Per-category granular consent toggles — out of v1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (normative) | Research Support |
|----|-------------------------|------------------|
| AUTH-01 | Account creation with email + password; CPF validation + encryption **deferred to Phase 2 per D-04** (original text mentions CPF at signup; planner MUST re-word) | Auth.js v5 credentials provider + `@auth/drizzle-adapter` + argon2; CPF columns exist on `users` but NULL-allowed until Phase 2 |
| AUTH-02 | Log in with email + password; session persists across refresh | `@auth/drizzle-adapter` database sessions (not JWT) so AUTH-03 invalidation is possible; `sessions` table from schema sketch |
| AUTH-03 | Server-side session invalidation on logout | Database sessions expose `DELETE FROM sessions WHERE id=?` — JWT cannot do this; reason the adapter is mandatory |
| AUTH-04 | Password reset via email link; single-use, time-limited | `password_reset_tokens` table; token = random 32 B base64url; argon2-hashed for DB storage; 1-hour TTL; SES template via React Email |
| AUTH-05 | Login rate-limit (5 / 15 min → lockout + unlock email); password reset rate-limit (3 / hour / email) | Postgres `auth_rate_limits` table per D-05; sliding-window counter pattern; `account_locks` with unlock-token; Cloudflare Turnstile after 2nd failure per D-07 |
| AUTH-06 | Passwords = argon2 hashes; CPF = AES-256-GCM + SHA-256 uniqueness hash; neither ever logged | `argon2` node native module; `node:crypto` `createCipheriv('aes-256-gcm', …)`; `piiScrubber` + Sentry `beforeSend` enforce no-log |
| LGPD-01 | Signup-time consent row per D-16; reusable `ConsentScreen` | `user_consents` append-only; `scope` discriminated-union; `ConsentScreen` accepts a `scope` prop so Phase 2 reuses it unchanged |
| LGPD-05 | All personal data stored in Brazilian territory | Railway Postgres `sa-east-1`; no cross-border data services in Phase 1 (Sentry EU is metadata only and PII is scrubbed pre-send) |
| LGPD-06 | No PII in application logs, Sentry, or traces; verified with a test capture | `piiScrubber` + Sentry `beforeSend` + structured logger wrapper; unit test with a fixed fake CPF corpus |
| SEC-01 | Every endpoint filters by session `user_id`; 404 on cross-user access | `getSessionUserId()` helper required at the top of every route; Drizzle query helpers that return `undefined` (→ 404) for non-owning reads |
| SEC-02 | Session cookies `HttpOnly` + `Secure` + `SameSite=Lax`; rotate on privilege change | Auth.js v5 defaults (`httpOnly: true`, `secure: true` when `NEXTAUTH_URL` is https, `sameSite: 'lax'`); privilege-rotation helper called on password change and admin-elevation (admin ships in Phase 6) |
| OPS-01 | Structured JSON logs with hashed user IDs, no PII; 30-day retention; Sentry EU + `beforeSend` | `pino` (Node) / custom wrapper for edge; `de.sentry.io` DSN; `beforeSend` uses `piiScrubber`; Railway logs are auto-rotated; additional guard: `logger.forbidden` list for known-PII keys |
| OPS-04 | Runtime assertion throws if `NODE_ENV=production` and sandbox credentials detected | `lib/env.ts` Zod schema with `.refine()` guard; imported at the top of `app/layout.tsx` AND `jobs/worker-entrypoint.ts` so both services fail fast |
</phase_requirements>

---

## Executive Summary

Phase 1 lays down the foundation every subsequent phase will depend on: a three-service Railway deployment in `sa-east-1` (web + worker + Postgres), a Drizzle-managed schema baseline for identity and operational tables, Auth.js v5 credentials authentication with database-backed sessions, LGPD scaffolding (append-only consent log, DSR request stubs, reusable `ConsentScreen`, `piiScrubber`), and observability (Sentry EU + structured JSON logs + a fail-fast sandbox/prod env assertion). **No Pluggy, no ASAAS, no LLM, no dashboard aggregations in this phase.**

The research confirms the full toolchain is available in current published versions and compatible with Next.js 16 App Router. The only material deviation from STACK.md is the `@brazilian-utils/br-validations` package name — it does not exist on npm. The canonical published package is **`@brazilian-utils/brazilian-utils@2.3.0`** (exports `isValid` / `format` helpers for CPF). Planner MUST use the real package name in plan 01-02.

Two runtime-verification items remain (non-blocking for planning):
1. Railway `sa-east-1` region availability at project-creation time — STATE.md already flags this; plan 01-01 MUST perform the check as its first task and include a documented fallback (AWS RDS `sa-east-1` + Railway compute in `us-east-1` is NOT acceptable under LGPD — fallback must still be BR territory, e.g., Render BR if it gains a region, or direct GCP `southamerica-east1` + Cloud SQL).
2. SES production access approval time (24–48 h) — plan 01-04 must initiate the request on day 1 of that plan.

**Primary recommendation:** Sequence Phase 1 exactly as D-20 suggests — 01-01 scaffolds Railway + Drizzle + Sentry SDK wiring (so boot-time errors during migrations are captured), 01-02 lands Auth.js + rate-limit + Turnstile + `lib/crypto.ts`, 01-03 lands LGPD (`ConsentScreen`, `user_consents`, DSR stubs, `piiScrubber` + audit_log auth events), 01-04 closes observability (Sentry full wiring, structured logger, env assertion, SES prod-access, bounce webhook, Phase-2-ready `webhook_events` pattern). Use `pnpm` as the package manager (per STACK.md); use `drizzle-kit generate` + `drizzle-kit migrate` (not `push`) because Railway is production infra from day one and `push` is unsafe against live data.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Sign-up / login form rendering + client-side validation | Browser | Frontend Server (RSC) | Forms are client components (React Hook Form hydrates); initial page HTML is server-rendered for fast FCP on mobile 3G |
| Credentials verification (argon2 hash compare) | API / Backend (Next.js server action + Auth.js) | — | argon2 cannot run in edge; MUST be Node runtime (`export const runtime = 'nodejs'`) |
| Session storage + lookup | Database | API / Backend | `@auth/drizzle-adapter` reads/writes the `sessions` table; auth middleware reads the session cookie in the Node runtime only |
| Rate limiting (login / reset) | Database | API / Backend | D-05 locks this tier to Postgres (`auth_rate_limits` counter); middleware reads + writes in the route handler |
| CPF encryption helper | API / Backend | — | AES-256-GCM uses `node:crypto`; never runs in browser or edge; key lives only in worker/web env vars |
| Consent record write | API / Backend | Database | Route handler inserts `user_consents` row inside the same transaction as user creation |
| DSR request submission + acknowledgment email | API / Backend (route) + Worker (email send) | Database (`dsr_requests`) | Route inserts row and enqueues pg-boss job; worker runs SES call out-of-band so the HTTP response is < 200 ms |
| SES bounce webhook ingestion | API / Backend (webhook route, Node runtime) | Worker | Route does auth + idempotent insert + enqueue + return 200; worker writes suppression rows |
| Sentry error capture | Browser + API + Worker | — | `@sentry/nextjs` runs in all three runtimes; `beforeSend` must scrub in each |
| Structured JSON logging | API / Backend + Worker | — | `pino` in Node (web + worker); edge middleware uses a minimal wrapper writing to `console.log` with the same JSON shape |
| Sandbox/prod env assertion | API / Backend + Worker | — | `lib/env.ts` imported at every runtime entrypoint so a missing / sandbox value hard-crashes the boot sequence |
| Consent UI component | Browser | — | `ConsentScreen` is a client component (checkbox state); it renders inside the `AuthShell` for Phase 1 and inside a Pluggy-connect modal for Phase 2 |

**Tier invariants the planner must preserve:**
- Any route that imports `lib/crypto.ts` or `argon2` MUST declare `export const runtime = 'nodejs'` — the edge runtime has neither.
- Any route that imports `lib/env.ts` (which is nearly every route) still works on the edge, but the `.refine()` guards referencing `process.env.PLUGGY_ENV` will not trigger on the edge — the guard belongs at boot-time in `instrumentation.ts`, which runs once in Node.

---

## Stack Verification

### Package registry truth (verified 2026-04-22 via `npm view`)

| Package | Published version | STACK.md version | Match? | Notes |
|---------|-------------------|------------------|--------|-------|
| `next` | 16.2.4 | ^16.2 | ✓ | App Router + Server Actions stable [VERIFIED: npm view] |
| `next-auth` (v5 beta) | **`next-auth@beta` = 5.0.0-beta.31** | ^5.0 | ✓ (install via `next-auth@beta`) | Auth.js v5 is still in beta at the time of research. The stable package `next-auth@4.24.14` is Auth.js v4 and is NOT what STACK.md means. Planner MUST install with the `@beta` tag [VERIFIED: npm view] |
| `@auth/drizzle-adapter` | 1.11.2 | ^1.11 | ✓ | Drizzle-native session adapter [VERIFIED: npm view] |
| `@auth/core` | 0.34.3 | — | peer dep of `@auth/drizzle-adapter`; `next-auth@5` bundles it transitively [VERIFIED: npm view] |
| `drizzle-orm` | 0.45.2 | ^0.45 | ✓ | [VERIFIED: npm view] |
| `drizzle-kit` | 0.31.10 | ^0.31 | ✓ | [VERIFIED: npm view] |
| `pg-boss` | 12.15.0 | ^12 | ✓ | Requires Postgres 13+ [VERIFIED: npm view] |
| `postgres` (node driver) | 3.4.9 | Latest | ✓ | Recommended driver for Drizzle Postgres; preferred over `pg` for cleaner Drizzle integration [VERIFIED: npm view] |
| `zod` | 4.3.6 | ^4.0 | ✓ | Zod v4 stable [VERIFIED: npm view] |
| `@hookform/resolvers` | 5.2.2 | Latest | ✓ | Zod v4 support confirmed by registry metadata (open concern in STACK.md is now resolved) [VERIFIED: npm view] |
| `argon2` | 0.44.0 | Latest | ✓ | Native module — see Landmine #2 below [VERIFIED: npm view] |
| `@sentry/nextjs` | 10.49.0 | ^10 | ✓ | Next.js 16 compatible [VERIFIED: npm view] |
| `@serwist/next` | 9.5.7 | Latest | ✓ | Open concern in STATE.md resolved — package name confirmed [VERIFIED: npm view]. **NOTE:** Phase 4, not Phase 1 |
| `@aws-sdk/client-ses` | 3.1034.0 | — | ✓ | Used in 01-04 for SES bounce worker + DSR acknowledgment [VERIFIED: npm view] |
| `@react-email/render` | 2.0.7 | — | ✓ | Renders React Email components to HTML at send time [VERIFIED: npm view] |
| `react-email` | 6.0.0 | — | ✓ | Dev-time preview server; not in production bundle [VERIFIED: npm view] |
| `pino` | 10.3.1 | — | ✓ | Fastest structured logger; Node runtime only [VERIFIED: npm view] |
| `@marsidev/react-turnstile` | 1.5.0 | — | ✓ | Well-maintained React wrapper for Cloudflare Turnstile; UI-SPEC references it [VERIFIED: npm view]. Alternative: load the official Cloudflare script directly |
| `@brazilian-utils/br-validations` | **NOT PUBLISHED** | ^6.3 | **✗ — STACK.md IS WRONG** | This package name does not resolve. Use **`@brazilian-utils/brazilian-utils@2.3.0`** instead; it exports `isValid(cpf)` / `format(cpf)` for CPF [VERIFIED: npm view] |
| `rate-limiter-flexible` | 11.0.1 | — | Optional | If hand-rolling the counter feels brittle, `rate-limiter-flexible` has a `RateLimiterPostgres` mode that matches D-05; otherwise we hand-roll since the schema is tiny [VERIFIED: npm view] |

**Stack assumption corrections the planner MUST carry forward:**
1. Install Auth.js v5 with `pnpm add next-auth@beta` (the `@beta` tag is load-bearing — `pnpm add next-auth` resolves to v4 which is incompatible with `@auth/drizzle-adapter@1.11`).
2. Use `@brazilian-utils/brazilian-utils@^2.3`, not the non-existent `br-validations` sub-package.

### Runtime verification items deferred to the executor

| Item | Where | How |
|------|-------|-----|
| Railway `sa-east-1` region available for Postgres + services | Plan 01-01, task 1 | `railway up` / Railway web console — if not available, halt and escalate (do NOT deploy outside BR) [ASSUMED availability based on Railway's public region list as of mid-2025; verify at project creation] |
| SES production access granted | Plan 01-04 task 1 | Submit request immediately; dev/staging mails go to verified addresses only in sandbox mode |
| Node `argon2` prebuild available for Railway's container base image | Plan 01-02 task 2 | First `pnpm install` on Railway build must complete without `node-gyp` rebuild. Fallback = switch to `@node-rs/argon2` (pure Rust prebuilt binaries) if node-gyp fails — same API surface |

---

## Implementation Playbook

### Plan slice 01-01 — Railway + Drizzle + Sentry boot wiring

**Scope:** Provision the three Railway services in `sa-east-1`, wire the monorepo structure, stand up Drizzle with the Phase 1 schema, run the initial migration, install `@sentry/nextjs` so boot-time errors during schema setup are captured.

**Key decisions:**

1. **Monorepo layout (single repo, two services, one Dockerfile per entrypoint).** Follow the ARCHITECTURE.md Recommended Project Structure: `src/app/` (web), `src/jobs/` (worker), `src/db/`, `src/services/`, `src/lib/`, `src/components/`. Two `package.json` scripts: `start:web` = `next start -p ${PORT:-3000}`, `start:worker` = `node --enable-source-maps dist/jobs/worker.js` (compile via `tsx build` or `next build` for shared code + a small bundler like `tsup` for the worker entrypoint). Railway lets you set different start commands per service while sharing the build output.

2. **Railway service topology** [CITED: Railway docs — https://docs.railway.com/guides/services]:
   - Service `postgres` — Railway managed Postgres 16, region `sa-east-1`. Exports `DATABASE_URL`.
   - Service `web` — Node 20 LTS (argon2 prebuild compatibility), start command `pnpm start:web`, region `sa-east-1`, autoscale disabled in v1.
   - Service `worker` — same Docker image, start command `pnpm start:worker`, region `sa-east-1`, **no inbound port** (worker is pg-boss polling against Postgres).
   - Shared env: `DATABASE_URL` (reference variable pointing at the `postgres` service), `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `SENTRY_DSN`, `AWS_*`, `PLUGGY_*` (sandbox in Phase 1), `ASAAS_*` (unused Phase 1), `NODE_ENV`.

3. **Drizzle migration workflow — use `generate + migrate`, NOT `push`.**
   - `drizzle-kit generate` — writes SQL into `src/db/migrations/NNNN_description.sql` from schema TS files at commit time.
   - `drizzle-kit migrate` — runs pending migrations against `DATABASE_URL` at deploy time.
   - Wire the migration into the Railway build phase via `postbuild` or an explicit predeploy: `pnpm drizzle-kit migrate`. This is idempotent; Drizzle tracks applied migrations in `drizzle.__migrations` (managed automatically) [CITED: Drizzle docs — https://orm.drizzle.team/docs/migrations].
   - `push` is for local prototyping only — it rewrites schema without preserving data and is unsafe once migrations are part of deploy history.

4. **Phase 1 schema — tables that MUST exist.**

| Table | Purpose | Phase-1 columns (minimum) | Indexes / constraints |
|-------|---------|---------------------------|------------------------|
| `users` | Identity | `id uuid PK` default `gen_random_uuid()`, `email text UNIQUE NOT NULL` (lowercased at write), `email_verified_at timestamptz NULL`, `password_hash text NOT NULL` (argon2), `cpf_hash bytea NULL` (SHA-256; becomes NOT NULL in Phase 2), `cpf_enc bytea NULL` (AES-256-GCM; becomes NOT NULL in Phase 2), `subscription_tier text NOT NULL DEFAULT 'paid'` (flipped to `'free'` in Phase 5), `created_at timestamptz NOT NULL DEFAULT now()`, `deleted_at timestamptz NULL` | `UNIQUE(email)`, `UNIQUE(cpf_hash) WHERE cpf_hash IS NOT NULL` (partial index — lets Phase 1 users be CPF-less) |
| `sessions` | Auth.js database sessions | `id uuid PK`, `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `session_token text UNIQUE NOT NULL`, `expires timestamptz NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()` | `INDEX(user_id)` for AUTH-03 logout-all |
| `accounts_oauth` | Required by `@auth/drizzle-adapter` schema even when only credentials provider is used | Follow the adapter's required shape exactly (see `@auth/drizzle-adapter` README — table is named `account`, not `accounts`, in the adapter default; we MUST rename it to avoid colliding with the Pluggy `accounts` table added in Phase 2). Rename via Drizzle `pgTable('accounts_oauth', …)` with the adapter's `accounts:` table mapping | FK to `users.id` CASCADE |
| `verification_tokens` | Auth.js adapter requirement for email/token flows | Adapter default shape; used in Phase 1 for password-reset tokens | `UNIQUE(identifier, token)` |
| `user_consents` | LGPD append-only consent audit | `id uuid PK`, `user_id uuid NOT NULL REFERENCES users(id)`, `scope text NOT NULL` (e.g., `'ACCOUNT_CREATION'`, later `'PLUGGY_CONNECTOR:123'`), `action text NOT NULL` (`'GRANTED' \| 'REVOKED'`), `consent_version text NOT NULL` (semver of the ToS/PP text hash), `ip_address inet NULL`, `user_agent text NULL`, `granted_at timestamptz NULL`, `revoked_at timestamptz NULL`, `created_at timestamptz NOT NULL DEFAULT now()` | `INDEX(user_id, scope, created_at DESC)`; **NO update, NO delete** (enforce at app layer — append-only) |
| `audit_log` | Auth-event audit trail (Phase 1 subset per D-19) | `id uuid PK`, `user_id uuid NULL` (NULL for pre-auth events), `actor_type text NOT NULL` (`'USER' \| 'SYSTEM'`), `actor_id uuid NULL`, `action text NOT NULL` (enum in code), `entity_type text NULL`, `entity_id uuid NULL`, `ip_address inet NULL`, `user_agent text NULL`, `metadata jsonb NULL` (PII-scrubbed), `created_at timestamptz NOT NULL DEFAULT now()` | `INDEX(user_id, created_at DESC)`, `INDEX(action, created_at DESC)` |
| `admin_access_log` | SEC-03 skeleton (full admin wiring in Phase 6) | `id uuid PK`, `admin_user_id uuid NOT NULL`, `target_user_id uuid NOT NULL`, `resource_type text`, `resource_id uuid NULL`, `action text NOT NULL`, `ip_address inet NULL`, `created_at timestamptz NOT NULL DEFAULT now()` | `INDEX(admin_user_id, created_at DESC)` |
| `webhook_events` | Idempotent webhook log (SES bounce in Phase 1; Pluggy in Phase 2; ASAAS in Phase 5) | `id uuid PK`, `source text NOT NULL` (`'SES' \| 'PLUGGY' \| 'ASAAS'`), `event_type text NOT NULL`, `event_id text NOT NULL`, `payload jsonb NOT NULL`, `processed_at timestamptz NULL`, `created_at timestamptz NOT NULL DEFAULT now()` | `UNIQUE(source, event_id)` — idempotency key |
| `subscriptions` (skeleton) | Empty Phase-1 placeholder so Phase 5 doesn't need a user-table migration | `id uuid PK`, `user_id uuid UNIQUE NOT NULL REFERENCES users(id)`, `provider text NULL`, `provider_subscription_id text NULL`, `plan_id text NULL`, `status text NOT NULL DEFAULT 'NONE'` (enum: `'NONE' \| 'ACTIVE' \| 'PAST_DUE' \| 'CANCELED'`), `current_period_end timestamptz NULL`, `cancel_at_period_end boolean NOT NULL DEFAULT false`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` | `UNIQUE(user_id)` |
| `dsr_requests` | DSR stub per D-17 | `id uuid PK`, `user_id uuid NOT NULL REFERENCES users(id)`, `request_type text NOT NULL` (`'EXPORT' \| 'DELETE' \| 'CORRECTION'`), `status text NOT NULL DEFAULT 'PENDING'` (`'PENDING' \| 'IN_PROGRESS' \| 'COMPLETED' \| 'FAILED'`), `requested_at timestamptz NOT NULL DEFAULT now()`, `resolved_at timestamptz NULL`, `metadata jsonb NULL` | `INDEX(user_id, requested_at DESC)`, `INDEX(status, requested_at)` (SLA monitoring in Phase 6) |
| `auth_rate_limits` | Per D-05 | `id uuid PK`, `identifier text NOT NULL` (email OR hashed IP), `bucket text NOT NULL` (`'LOGIN' \| 'PASSWORD_RESET' \| 'PASSWORD_RESET_IP'`), `window_start timestamptz NOT NULL`, `count int NOT NULL DEFAULT 1`, `created_at timestamptz NOT NULL DEFAULT now()` | `UNIQUE(identifier, bucket, window_start)` so atomic `ON CONFLICT DO UPDATE SET count = count+1` works |
| `account_locks` | Lockout + unlock-token state | `id uuid PK`, `user_id uuid NOT NULL REFERENCES users(id)`, `locked_at timestamptz NOT NULL`, `unlocks_at timestamptz NOT NULL`, `unlock_token_hash text NOT NULL` (argon2-hashed), `unlock_token_expires_at timestamptz NOT NULL`, `unlocked_at timestamptz NULL`, `unlocked_via text NULL` (`'EMAIL_LINK' \| 'TIMEOUT'`) | `INDEX(user_id, unlocks_at DESC)` |
| `password_reset_tokens` | AUTH-04 | `id uuid PK`, `user_id uuid NOT NULL`, `token_hash text NOT NULL` (argon2 — NOT plaintext), `expires_at timestamptz NOT NULL`, `used_at timestamptz NULL`, `created_at timestamptz NOT NULL DEFAULT now()` | `INDEX(user_id, created_at DESC)`, `UNIQUE(token_hash)` |
| `ses_suppressions` | Bounce/complaint blocklist (D-15) | `id uuid PK`, `email_lower text UNIQUE NOT NULL`, `reason text NOT NULL` (`'BOUNCE' \| 'COMPLAINT'`), `first_seen_at timestamptz NOT NULL DEFAULT now()`, `notification_ids text[] NOT NULL DEFAULT '{}'` | `UNIQUE(email_lower)` |

   **Schema source of truth:** Split by aggregate into `src/db/schema/*.ts` — e.g., `users.ts`, `sessions.ts`, `consents.ts`, `auditLog.ts`, `auth.ts` (rate limits, locks, password resets), `webhooks.ts`, `subscriptions.ts`, `dsr.ts`, `ses.ts`. Re-export from `src/db/schema/index.ts`. Drizzle `drizzle.config.ts` points at this barrel file.

5. **Sentry install at this slice.** Run `pnpm dlx @sentry/wizard@latest -i nextjs`. Then hand-edit `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`: pin `Sentry.init({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENV, tracesSampleRate: 0.1, beforeSend: scrubBeforeSend })`. The `scrubBeforeSend` function imports from `lib/piiScrubber.ts` — which is only fully populated in 01-03, so a minimal stub in 01-01 that still strips CPF (regex-based) is enough to protect schema-setup boot errors.

6. **DSN routing to Sentry EU.** Simply use a DSN issued from a project created in the `de.sentry.io` data plane. No extra config; the DSN hostname IS the routing. Test with a deliberate `throw` in a dev-only route and confirm it appears in the EU dashboard.

**Landmines for 01-01:**
- `gen_random_uuid()` requires the `pgcrypto` extension. Ship a migration with `CREATE EXTENSION IF NOT EXISTS pgcrypto;` as the first statement.
- pg-boss creates its own `pgboss` schema on first `boss.start()`. The app schema is `public` — keep them isolated. Grant on both schemas to the app DB user.
- Railway's build phase runs `pnpm install` once per service. The `postgres` service is data-only; web + worker share the build. Set build command = `pnpm build`, start commands differ.
- Next.js 16 App Router requires `export const dynamic = 'force-dynamic'` on any route that reads cookies / headers at render time — or uses `cookies()` from `next/headers` which marks the route dynamic automatically. Auth.js v5's `auth()` helper does both. Default rendering mode for `(auth)/**` and `(dashboard)/**` routes MUST be dynamic — do NOT add `export const revalidate = N`.

### Plan slice 01-02 — Auth.js v5 + argon2 + AES-256-GCM + rate-limit + Turnstile

**Scope:** Auth.js v5 credentials provider wired to Drizzle; signup + login + logout + password-reset + password-reset-confirm routes; Postgres-backed rate limiting (D-05); Cloudflare Turnstile after the 2nd failed attempt (D-07); `lib/crypto.ts` AES-256-GCM helper; `lib/validation.ts` Zod schemas (including CPF validator usable in Phase 2).

**Key patterns:**

1. **Auth.js v5 credentials provider shape.**

```typescript
// src/auth.ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import argon2 from "argon2";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { LoginSchema } from "@/lib/validation";

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts_oauth,  // renamed to not collide with Pluggy accounts
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verification_tokens,
  }),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 }, // 30 days
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = LoginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = await db.query.users.findFirst({
          where: (u, { eq }) => eq(u.email, email.toLowerCase()),
        });
        if (!user || !user.password_hash) return null;
        const ok = await argon2.verify(user.password_hash, password);
        if (!ok) return null;
        return { id: user.id, email: user.email };
      },
    }),
  ],
  cookies: {
    sessionToken: {
      name: "__Secure-next-auth.session-token",
      options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    },
  },
});
```

[CITED: authjs.dev — Auth.js v5 Credentials provider + Drizzle adapter pattern; database session strategy is required for server-side revocation]

2. **Signup is NOT Auth.js — it's a server action.** Auth.js's credentials provider only handles `authorize` (login). Sign-up is a plain Next.js server action: validate with Zod → check email not taken → `argon2.hash(password)` → `INSERT INTO users` → `INSERT INTO user_consents` in the same transaction → `INSERT INTO audit_log` (`action='signup'`) → trigger `signIn('credentials', {...})` to start the session → redirect to `/dashboard`. Use Drizzle's transaction API:

```typescript
await db.transaction(async (tx) => {
  const [user] = await tx.insert(users).values({ email, password_hash }).returning();
  await tx.insert(user_consents).values({
    user_id: user.id, scope: 'ACCOUNT_CREATION', action: 'GRANTED',
    consent_version, ip_address, user_agent, granted_at: new Date(),
  });
  await tx.insert(audit_log).values({ user_id: user.id, actor_type: 'USER', action: 'signup', ip_address, user_agent });
});
```

3. **argon2 parameters.** Use defaults (`argon2id`, `timeCost=3`, `memoryCost=65536`) — OWASP-recommended as of 2025. Do NOT drop memoryCost on Railway; the app container has plenty. [CITED: OWASP Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html]

4. **AES-256-GCM helper (`lib/crypto.ts`).**

```typescript
// 12-byte nonce per encryption; stored alongside ciphertext + auth tag
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const KEY = Buffer.from(env.ENCRYPTION_KEY, "base64"); // 32 bytes

export function encryptCPF(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]); // 12 + 16 + N bytes
}

export function decryptCPF(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function hashCPF(plaintext: string): Buffer {
  // Deterministic for uniqueness lookups. HMAC-SHA-256 with a server-side pepper is better than plain SHA-256
  // to resist rainbow attacks if the DB is leaked but the key isn't. Pepper comes from env.CPF_HASH_PEPPER.
  return createHmac("sha256", env.CPF_HASH_PEPPER).update(plaintext).digest();
}
```

   **Key management discretion choice (from CONTEXT.md):** single `ENCRYPTION_KEY` env var (32 bytes, base64-encoded) in Railway. Rotation procedure documented in `docs/ops/encryption-key-rotation.md` (to be written in 01-02). Envelope/KMS deferred to Phase 6.

5. **CPF validation (for Phase 2; schema ready in Phase 1).** Use `@brazilian-utils/brazilian-utils` (NOT `br-validations` — that package does not exist):

```typescript
import { isValid as isValidCPF, format as formatCPF } from "@brazilian-utils/brazilian-utils";
import { z } from "zod";

export const CPFSchema = z.string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => s.length === 11, "CPF must be 11 digits")
  .refine(isValidCPF, "Invalid CPF (check digit failed)");
```

   The validator rejects the known test CPFs (all-zero, all-ones, etc.). Used in Phase 2 at the first-bank-connect gate.

6. **Postgres-backed rate limit (D-05).** Sliding-window counter — one row per (identifier, bucket, 15-minute floor of now).

```typescript
// pseudocode
const windowStart = floor15min(new Date());
await db.insert(auth_rate_limits)
  .values({ identifier, bucket: 'LOGIN', window_start: windowStart, count: 1 })
  .onConflictDoUpdate({
    target: [auth_rate_limits.identifier, auth_rate_limits.bucket, auth_rate_limits.window_start],
    set: { count: sql`${auth_rate_limits.count} + 1` },
  });

// Query: sum of counts for this identifier+bucket in the last 15 minutes
const total = await db.select({ c: sql<number>`coalesce(sum(count), 0)` })
  .from(auth_rate_limits)
  .where(and(
    eq(auth_rate_limits.identifier, identifier),
    eq(auth_rate_limits.bucket, 'LOGIN'),
    gte(auth_rate_limits.window_start, fifteenMinutesAgo),
  ));

if (total[0].c >= 5) return Response.json({ error: 'locked' }, { status: 429 });
```

   Cron sweeper: a pg-boss scheduled job `sweep-rate-limits` runs hourly and deletes rows where `window_start < now() - interval '1 hour'`.

7. **Cloudflare Turnstile (D-07).** Client side renders the invisible widget after the 2nd 401 response from `/api/auth/callback/credentials` (tracked in React state of `LoginForm`). Server verifies the `cf-turnstile-response` token via `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` — use a minimal `verifyTurnstile(token, ip)` helper; reject if `success=false`. [CITED: Cloudflare Turnstile docs — https://developers.cloudflare.com/turnstile/get-started/server-side-validation/]

8. **Password reset flow.**
   - `/api/auth/reset-request` (POST): Zod-validate email → rate-limit (D-08) → if user exists, generate `crypto.randomBytes(32).toString('base64url')`, insert `password_reset_tokens` with `argon2.hash(token)`, enqueue `send-password-reset-email` pg-boss job → always return 200 with the same response body regardless of whether the email exists (D-08 anti-enumeration).
   - `/api/auth/reset/validate?token=…` (GET): return 200 only if the token exists, is unexpired, and is unused.
   - `/api/auth/reset/confirm` (POST): Zod-validate new password → `argon2.verify(token_hash, submitted_token)` via a SELECT-then-compare (safe; no timing attack at this granularity) → mark `used_at=now()` → `UPDATE users SET password_hash=` → invalidate all existing sessions for that user (`DELETE FROM sessions WHERE user_id=$1`) → `INSERT INTO audit_log` → redirect to `/login`.

9. **SEC-02 cookies.** Auth.js v5 defaults to `httpOnly: true`, `secure: true` (when `AUTH_URL` / `NEXTAUTH_URL` is https), `sameSite: 'lax'`. Explicit override in the `cookies` config block above is a belt-and-suspenders verification. Rotate on password change: delete all sessions for the user (as above).

**Landmines for 01-02:**
- `argon2` is a native module. Railway build uses `pnpm install` which should fetch the prebuilt binary for Node 20 on x64 Linux. If the prebuild is missing for the container arch, fall back to `@node-rs/argon2` (pure Rust prebuilt). Decide once; do not mix.
- Next.js Server Actions with `argon2` must NOT run on the edge. All auth-related routes need `export const runtime = 'nodejs';` — document this in a comment at the top of every auth route. Missing it produces an opaque runtime error at deploy time.
- Do NOT expose the Turnstile secret key via `NEXT_PUBLIC_`. Only the site key is public; `TURNSTILE_SECRET_KEY` is server-only and used in `verifyTurnstile`.
- Auth.js v5 callback routes live at `src/app/api/auth/[...nextauth]/route.ts` — re-export `handlers.GET`, `handlers.POST` from the `auth.ts` config. Do not also define a legacy v4 `[...nextauth]` config; that path is load-bearing.

### Plan slice 01-03 — LGPD scaffolding (consent, DSR, piiScrubber, audit events)

**Scope:** `ConsentScreen` reusable component (per UI-SPEC §2.8); consent-write integrated into the signup server action; DSR route stubs + worker + acknowledgment email; `lib/piiScrubber.ts` utility with rule-based pipeline; Phase-1 `audit_log` event catalogue wired.

**Key patterns:**

1. **`ConsentScreen` props contract (from UI-SPEC).**

```typescript
type ConsentScope = 'ACCOUNT_CREATION' | `PLUGGY_CONNECTOR:${string}`;

interface ConsentScreenProps {
  scope: ConsentScope;
  onConsent: (consentedAt: Date) => void;
  onDecline?: () => void;
  isLoading?: boolean;
}
```

   Scope configuration in `src/lib/consentScopes.ts` — one object per scope with `title`, `dataPoints: string[]`, `legalBasis: string`, `version: string` (semver hashed from the actual ToS/PP markdown files). Phase 2 adds `PLUGGY_CONNECTOR:*` entries without touching the component.

2. **Consent row write.** Happens inside the signup transaction (01-02). The `consent_version` column stores the semver that was current at consent time — so if we update the privacy policy we can re-prompt users whose consent version is stale. Hash the ToS / PP markdown files at build time into `src/lib/consentVersions.ts` and load `versions.ACCOUNT_CREATION` into the insert.

3. **DSR stubs (D-17).**
   - `POST /api/privacy/export` → validate session → insert `dsr_requests` (`request_type='EXPORT'`, `status='PENDING'`) → enqueue `dsr-acknowledge` pg-boss job (payload = `{ dsr_request_id }`) → return `{ protocol: dsr_request_id }`.
   - `POST /api/privacy/delete` → requires Turnstile token verification (belt-and-suspenders against automated abuse) + explicit `confirm_phrase: "EXCLUIR"` from the UI modal → same pattern — insert + enqueue → return protocol.
   - Phase-1 worker `dsr-acknowledge-worker`: SELECT the request, render a React-Email template (`src/emails/DSRAcknowledgment.tsx`) stating the 15-day statutory window for export / 30-day retention window for delete, and send via SES. Does NOT execute the actual export / deletion — that lands in Phase 6 plan 06-01.

4. **`piiScrubber` utility (D-18).** Pluggable-rule pipeline.

```typescript
// src/lib/piiScrubber.ts
export type Rule<T> = (input: T) => T;

const CPF_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g;
const CPF_RAW_REGEX = /(?<!\d)\d{11}(?!\d)/g; // 11 bare digits not adjacent to more digits
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_BR_REGEX = /\+?55?\s?\(?\d{2}\)?\s?\d{4,5}-?\d{4}/g;
const ACCOUNT_REGEX = /\b\d{4,6}-\d\b/g; // BR agência-conta
const TOKEN_LIKE_REGEX = /\b[A-Za-z0-9_-]{24,}\b/g; // base64-like, likely a token

const STRING_RULES: Rule<string>[] = [
  (s) => s.replace(CPF_REGEX, "[CPF]"),
  (s) => s.replace(CPF_RAW_REGEX, "[CPF]"),
  (s) => s.replace(EMAIL_REGEX, "[EMAIL]"),
  (s) => s.replace(PHONE_BR_REGEX, "[PHONE]"),
  (s) => s.replace(ACCOUNT_REGEX, "[ACCOUNT]"),
  (s) => s.replace(TOKEN_LIKE_REGEX, "[TOKEN]"),
  // Brazilian PIX name pattern — added in Phase 2 when we have the pattern corpus
];

export function scrubString(s: string): string {
  return STRING_RULES.reduce((acc, rule) => rule(acc), s);
}

export function scrubObject<T>(obj: T): T {
  // Recursive: stringify leaf strings via scrubString, preserve keys, short-circuit
  // on known PII keys (cpf, password, password_hash, description, descriptionRaw, account_number)
  // by replacing with '[REDACTED]'.
  // Implementation detail left to executor.
}
```

   Consumed from: Sentry `beforeSend` (scrubs `event.message`, `event.exception.values[].value`, `event.breadcrumbs[].message`, and the `event.extra` / `event.contexts` payloads); structured logger wrapper (`logger.info({...meta}, msg)` passes meta through `scrubObject`). Phase 3 adds LLM prompt builder as a third consumer.

5. **Phase-1 audit events (D-19).** Explicit event catalogue in `src/lib/auditEvents.ts` as a union type:

```typescript
export type AuthAuditAction =
  | 'signup'
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'account_locked'
  | 'account_unlocked'
  | 'consent_granted'
  | 'consent_revoked';
```

   Every event emits an `audit_log` row. `metadata` JSONB always passes through `piiScrubber.scrubObject` before INSERT — so `metadata.email` stores `"[EMAIL]"`, not the raw address. Login failures store only `user_id=NULL` + `metadata = { email_attempted_scrubbed: '[EMAIL]', reason: 'bad_password' | 'no_user' | 'locked' }` — we do NOT persist the raw email of a failed login because that would leak enumeration potential into the `audit_log`.

**Landmines for 01-03:**
- The `piiScrubber` test corpus must include edge cases: CPF with mixed formatting (`123.456.789-00`, `12345678900`, `123 456 789 00`), email inside a sentence, email inside a URL query string, multiline log lines, nested objects with PII deep in arrays. Test against a fixed fixture file.
- The SES acknowledgment email MUST NOT contain the CPF (there is no CPF at sign-up anyway, but this matters once Phase 2 wires CPF-bearing flows into the same email template). Review React Email template rendering — `{{user.cpf}}` would render whatever is passed in; pass scrubbed or masked data.
- The `dsr_requests` row should NOT include PII in `metadata`. `request_type` + timestamps + status + protocol ID are sufficient.

### Plan slice 01-04 — Observability + SES prod access + sandbox/prod assertion

**Scope:** Full Sentry EU wiring with `beforeSend` = `piiScrubber`; structured JSON logger (`pino` for Node, `console.log` JSON shape for edge); `lib/env.ts` Zod schema + `instrumentation.ts` boot-time assertion (OPS-04); SES production-access request initiated (D-12); SES bounce SNS → webhook → worker → `ses_suppressions` suppression list (D-15); `webhook_events` pattern validated with a real consumer (SES bounce) so Phase 2 inherits a proven idempotent-webhook pattern.

**Key patterns:**

1. **Sentry `beforeSend`.**

```typescript
// sentry.server.config.ts (and sentry.edge.config.ts, sentry.client.config.ts)
import * as Sentry from "@sentry/nextjs";
import { scrubObject, scrubString } from "@/lib/piiScrubber";

Sentry.init({
  dsn: process.env.SENTRY_DSN, // points at de.sentry.io
  environment: process.env.SENTRY_ENV, // 'development' | 'staging' | 'production'
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Scrub message + exception values + breadcrumbs + extras
    if (event.message) event.message = scrubString(event.message);
    event.exception?.values?.forEach((ex) => { if (ex.value) ex.value = scrubString(ex.value); });
    event.breadcrumbs?.forEach((bc) => { if (bc.message) bc.message = scrubString(bc.message); });
    if (event.extra) event.extra = scrubObject(event.extra);
    if (event.contexts) event.contexts = scrubObject(event.contexts);
    if (event.user) {
      // Hash user IDs before shipping to Sentry
      event.user = { id: event.user.id ? hashUserIdForSentry(event.user.id) : undefined };
    }
    return event; // synchronous; never throw inside beforeSend
  },
});
```

   [CITED: Sentry Next.js SDK docs — https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/filtering/] The `beforeSend` is called synchronously; it MUST NOT throw. Returning `null` drops the event entirely; return the (scrubbed) event to ship.

2. **EU region routing.** Sentry's data-plane routing is determined by the DSN hostname. A DSN of the shape `https://...@oNNNNN.ingest.de.sentry.io/PNNNN` ingests into the EU plane. Verify with a dev-mode test throw and check the `de.sentry.io` dashboard. [CITED: docs.sentry.io — data residency]

3. **Sentry `beforeSend` unit test (Success Criterion #4).**

```typescript
// tests/sentry.beforeSend.test.ts
import { beforeSend } from "@/lib/sentry";

it("strips CPF from message", () => {
  const event = { message: "Failed for user 123.456.789-00" } as any;
  const out = beforeSend(event)!;
  expect(out.message).toBe("Failed for user [CPF]");
});

it("strips email from exception value", () => {
  const event = { exception: { values: [{ value: "login for user@example.com failed" }] } } as any;
  const out = beforeSend(event)!;
  expect(out.exception.values[0].value).toBe("login for [EMAIL] failed");
});

it("scrubs nested extras", () => {
  const event = { extra: { payload: { cpf: "12345678900", description: "PIX 123.456.789-00" } } } as any;
  const out = beforeSend(event)!;
  expect(out.extra.payload.cpf).toBe("[REDACTED]");
  expect(out.extra.payload.description).toBe("PIX [CPF]");
});
```

4. **Structured logger.**

```typescript
// src/lib/logger.ts
import pino from "pino";
import { scrubObject } from "@/lib/piiScrubber";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "web" },
  formatters: { level: (label) => ({ level: label }) },
  hooks: {
    logMethod(args, method) {
      // args[0] can be an object or string. Scrub object payloads before emit.
      if (typeof args[0] === "object" && args[0] !== null) {
        args[0] = scrubObject(args[0]);
      }
      return method.apply(this, args);
    },
  },
});
```

   For edge middleware (can't use `pino`), provide `src/lib/logger.edge.ts` — a thin wrapper that emits the same JSON shape via `console.log(JSON.stringify(...))` and still passes through `scrubObject`.

5. **`lib/env.ts` + `instrumentation.ts`.**

```typescript
// src/lib/env.ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]),
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[A-Za-z0-9+/=_-]+$/).refine(
    (s) => Buffer.from(s, "base64").length === 32,
    "ENCRYPTION_KEY must decode to 32 bytes",
  ),
  CPF_HASH_PEPPER: z.string().min(32),
  SENTRY_DSN: z.string().url(),
  SENTRY_ENV: z.enum(["development", "staging", "production"]),
  PLUGGY_ENV: z.enum(["sandbox", "production"]).optional(), // unused Phase 1 but tracked
  ASAAS_ENV: z.enum(["sandbox", "production"]).optional(),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  AWS_REGION: z.string().default("sa-east-1"),
  SES_FROM_EMAIL: z.string().email().default("no-reply@portalfinance.app"),
  TURNSTILE_SITE_KEY: z.string(),
  TURNSTILE_SECRET_KEY: z.string(),
  NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY: z.string(), // mirrors TURNSTILE_SITE_KEY for the client bundle
}).refine((e) => {
  if (e.NODE_ENV !== "production") return true;
  // Production sandbox/prod guard (OPS-04)
  const bad =
    (e.PLUGGY_ENV && e.PLUGGY_ENV !== "production") ||
    (e.ASAAS_ENV && e.ASAAS_ENV !== "production") ||
    e.SENTRY_ENV !== "production";
  return !bad;
}, { message: "OPS-04 violation: production NODE_ENV with sandbox/test credentials detected" });

export const env = EnvSchema.parse(process.env);
```

   Next.js 16 supports `instrumentation.ts` at the project root — called once per runtime on cold start. Importing `env` there ensures the schema runs BEFORE any request is served:

```typescript
// instrumentation.ts
export async function register() {
  // side-effect import — throws at boot if env is invalid or OPS-04 violated
  await import("@/lib/env");
  await import("@/lib/sentry-server");
}
```

   The worker entrypoint (`src/jobs/worker.ts`) imports `lib/env` as its first statement before starting pg-boss.

6. **SES production access (D-12).** In the AWS console → SES → "Request production access." Justification template: "Transactional email for user authentication, password reset, account unlock, and LGPD data subject request acknowledgments on a Brazilian personal-finance SaaS. Expected monthly volume: < 10k emails. Bounce-handling webhook configured against SNS, with automatic suppression of bouncing addresses. DMARC, SPF, and DKIM configured at the apex (`portalfinance.app`). DMARC starts at `p=none` for aggregate reporting and will be upgraded after 30 days of clean reports." Submit on day 1 of 01-04.

7. **SES bounce → SNS → webhook → worker (D-15).** End-to-end:
   - Configure SES to publish bounces + complaints to an SNS topic (one-time setup in 01-04).
   - Subscribe the topic to `https://portalfinance.app/api/webhooks/ses/bounces` (HTTPS endpoint).
   - Webhook handler: (a) handle SNS subscription-confirmation GET/POST (call the `SubscribeURL`); (b) verify SNS message signature using `aws-sdk/client-sns` or a lightweight verifier; (c) `INSERT INTO webhook_events ... ON CONFLICT DO NOTHING` keyed on `(source='SES', event_id=Message.MessageId)`; (d) `boss.send('ses.bounce', { messageId })`; (e) return 200.
   - Worker `ses-bounce-worker`: SELECT the `webhook_events` row, extract `bouncedRecipients[]` from the payload, upsert `ses_suppressions` rows. Mark `processed_at`.
   - Pre-send guard: every SES-sending service (DSR acknowledge worker, password-reset worker, unlock worker) checks `ses_suppressions` and refuses to send to a suppressed address.

**Landmines for 01-04:**
- Sentry `beforeSend` must be SYNCHRONOUS (Sentry's contract). If we ever need async scrubbing (we don't in Phase 1), move it to a `Transport.send` wrapper instead — do not `await` in `beforeSend`.
- Pino's default transport writes to stdout; Railway captures stdout into their log system. Do NOT configure `pino-pretty` in production — it pretty-prints, which breaks JSON parsers downstream.
- SNS signature verification is NOT optional. An unverified `/api/webhooks/ses/bounces` endpoint is a free suppression-list poisoning vector. Use `sns-validator` or an inline X.509 verification against the `SigningCertURL`.
- `env.parse()` throws a ZodError with field-by-field detail. That error message will be emitted to stdout at boot — which is fine, but confirm it does NOT include the offending env values (ZodError doesn't include input by default; still, audit the exception path).

---

## Integration Pitfalls & Decisions Needed

### Pitfalls from PITFALLS.md actively relevant to Phase 1

| Pitfall | Relevance | Phase 1 mitigation |
|---------|-----------|---------------------|
| P4 — encrypt secrets at app layer | Pattern must be established for CPF (even if nullable in Phase 1) so Phase 2 inherits the tested AES-256-GCM helper | `lib/crypto.ts` shipped with unit tests in 01-02; Phase 2 imports it unchanged for `pluggy_item_id` |
| P10 — sandbox/prod confusion | OPS-04 direct map | `lib/env.ts` Zod refine in 01-04; boots via `instrumentation.ts` |
| P11 — per-source consent | LGPD-01 direct map | `user_consents` append-only schema + `ConsentScreen` (D-16); scope discriminated union typed so Phase 2 `PLUGGY_CONNECTOR:*` scopes drop in without schema change |
| P12 — complete deletion | LGPD-05 / LGPD-06 skeleton; full impl Phase 6 | `dsr_requests` + acknowledgment email in 01-03; 15-day / 30-day windows called out in the acknowledgment copy |
| P13 — PII in logs | LGPD-06 direct map | `piiScrubber` + Sentry `beforeSend` + logger wrapper; verified by unit test (Success Criterion #4) |
| P26 — IDOR on endpoints | SEC-01 direct map | Ship a `requireSession()` helper in 01-02 that returns `{ userId }` or throws 401; every route uses it; every Drizzle query includes `AND user_id = $userId`; Phase-1 integration test seeds two users and verifies user B cannot access user A's consent / audit rows |
| P28 — CPF validation + encryption | Schema ready Phase 1; enforced Phase 2 | Helpers (`CPFSchema`, `encryptCPF`, `hashCPF`) shipped and tested in 01-02; columns nullable; Phase 2 adds NOT-NULL migration and the Pluggy-connect gate |
| P29 — login rate limit | AUTH-05 direct map | `auth_rate_limits` + sliding window + Turnstile-after-2 + account-lock + unlock email |
| P36 — observability from day 1 | OPS-01 direct map | Sentry SDK installed in 01-01 (first task), fully configured in 01-04; structured logger wrapping `pino` |

### Decisions still needed from the planner (NOT the user)

These are within Claude's Discretion per CONTEXT.md and belong in the PLAN.md files, not in further discussion:

1. **Postgres driver:** `postgres@3.4.9` (recommended by Drizzle docs) vs `pg@8.20.0`. Recommend **`postgres`** — lighter, faster, first-class Drizzle support.
2. **Worker bundling:** `tsup` vs plain `tsc` for the worker entrypoint. Recommend **`tsup`** — handles tree-shaking of unused `src/app/*` code from the worker bundle.
3. **Password-reset token storage:** argon2 hash vs HMAC-SHA-256. Recommend **argon2** — we already have the library for password hashing; one-cost-tier (1 iteration instead of 3) makes verification fast enough.
4. **Rate-limit sliding window precision:** 15-minute buckets (simpler, slightly looser) vs per-second fine-grained tracking. Recommend **15-minute buckets with 3 overlapping buckets** — good enough for AUTH-05; avoids a token-bucket impl.
5. **Turnstile integration library:** `@marsidev/react-turnstile` (wrapper) vs raw `<script>` tag. Recommend **`@marsidev/react-turnstile`** per UI-SPEC §2.3.
6. **Auth.js v5 table name collision:** The default adapter uses `accounts` (for OAuth providers). Phase 2 ingests Pluggy `accounts`. Rename the Auth.js adapter's `accounts` table to `accounts_oauth` at schema definition time. Confirmed working — the adapter accepts per-table overrides in its config.

---

## Validation Architecture

> workflow.nyquist_validation is enabled in config.json (absent = treated as enabled; this project explicitly sets `true`). Full Validation Architecture included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **Vitest** (fastest, native ESM, TS-first; Next.js 16 App Router projects use it almost universally in 2025–2026) + **Playwright** for the auth / consent / DSR e2e flows. Vitest version at the time of research: 3.x stable. |
| Config file | `vitest.config.ts` (Wave 0 — create); `playwright.config.ts` (Wave 0 — create). Dev dependencies: `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`. |
| Quick run command | `pnpm vitest run --reporter=verbose` |
| Full suite command | `pnpm vitest run && pnpm playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| AUTH-01 | Signup with email + password creates `users` + `user_consents` + `audit_log` rows in a single transaction | integration | `pnpm vitest run tests/integration/auth/signup.test.ts` | ❌ Wave 0 |
| AUTH-02 | Login sets session cookie; refresh retains session (Playwright) | e2e | `pnpm playwright test tests/e2e/auth/login.spec.ts` | ❌ Wave 0 |
| AUTH-03 | Logout deletes the session row server-side | integration | `pnpm vitest run tests/integration/auth/logout.test.ts` | ❌ Wave 0 |
| AUTH-04 | Password reset email → token → new password; token is single-use | integration | `pnpm vitest run tests/integration/auth/passwordReset.test.ts` | ❌ Wave 0 |
| AUTH-05 | 6th failed login within 15 min returns 429; unlock email contains a single-use link; 3rd reset request within 1h returns 429 | integration | `pnpm vitest run tests/integration/auth/rateLimit.test.ts` | ❌ Wave 0 |
| AUTH-06 | `users.password_hash` starts with `$argon2id$`; `users.cpf_enc` (when set) decrypts to original; `users.cpf_hash` equals HMAC-SHA-256 of plaintext | unit | `pnpm vitest run tests/unit/lib/crypto.test.ts` | ❌ Wave 0 |
| LGPD-01 | Signup writes `user_consents` with correct scope + IP + UA; `ConsentScreen` renders scope-specific `dataPoints` | integration + unit (RTL) | `pnpm vitest run tests/integration/lgpd/signupConsent.test.ts tests/unit/components/ConsentScreen.test.tsx` | ❌ Wave 0 |
| LGPD-05 | No cross-border data. Verified indirectly via: (a) env assertion confirms `AWS_REGION=sa-east-1`; (b) CI check confirms `SENTRY_DSN` hostname ends with `de.sentry.io` (EU metadata plane — data stays out of US) | unit | `pnpm vitest run tests/unit/lib/env.test.ts` | ❌ Wave 0 |
| LGPD-06 | `piiScrubber` strips CPF (formatted + raw), email, phone, accounts, tokens from strings and nested objects; Sentry `beforeSend` produces a scrubbed event | unit | `pnpm vitest run tests/unit/lib/piiScrubber.test.ts tests/unit/lib/sentry.beforeSend.test.ts` | ❌ Wave 0 |
| SEC-01 | User B cannot fetch user A's consent / audit rows via any route; 404 on cross-user access (not 403) | integration | `pnpm vitest run tests/integration/security/idor.test.ts` | ❌ Wave 0 |
| SEC-02 | Session cookies have `HttpOnly`, `Secure`, `SameSite=Lax`; session rotates on password change | integration | `pnpm vitest run tests/integration/security/cookies.test.ts` | ❌ Wave 0 |
| OPS-01 | Log lines are valid JSON, contain `service`, `level`, `time`, and NO PII keys (`cpf`, `password`, `description`, `descriptionRaw`, `account_number`); `user_id` fields are hashed; Sentry `beforeSend` returns scrubbed events | unit + integration | `pnpm vitest run tests/unit/lib/logger.test.ts tests/integration/observability/sentry.test.ts` | ❌ Wave 0 |
| OPS-04 | `instrumentation.ts` import of `lib/env.ts` throws when `NODE_ENV=production` + `PLUGGY_ENV=sandbox` | unit | `pnpm vitest run tests/unit/lib/env.test.ts` | ❌ Wave 0 |
| — (infra) | Migration idempotence: running `drizzle-kit migrate` twice produces the same schema state | integration | `pnpm vitest run tests/integration/db/migrate.test.ts` (spins up a local Postgres via testcontainers) | ❌ Wave 0 |

### Nyquist Validation Dimensions (authoritative for the executor)

| Dimension | What it proves | Test shape | Evidence produced |
|-----------|----------------|------------|-------------------|
| **D1. Auth flows (signup, login, logout, reset)** | Credentials provider wired correctly; sessions persist and invalidate | integration (Drizzle against testcontainers Postgres) + 1 Playwright smoke | DB rows + response codes + Set-Cookie headers asserted |
| **D2. CPF validation (helper only — used in Phase 2)** | `CPFSchema` rejects invalid + test CPFs; encryption+decryption round-trip; hash is deterministic | unit | Given/when/then cases for 10 real + 10 invalid CPFs |
| **D3. Rate limit (login, password reset, per-IP)** | Counter increments atomically; 6th attempt within window returns 429; reset after window passes | integration (fake clock via Vitest `vi.useFakeTimers`) | Response codes over sequenced requests |
| **D4. Consent persistence** | Signup writes a consent row with correct scope + IP + UA; `ConsentScreen` renders correct copy per scope | integration + unit (RTL) | DB row assertion + rendered DOM snapshot |
| **D5. PII scrubbing** | `piiScrubber` scrubs strings, nested objects, arrays; Sentry `beforeSend` produces a scrubbed event; logger wrapper scrubs meta before emit | unit | Comparison of input fixture vs scrubbed output |
| **D6. Sandbox/prod env assertion** | `lib/env.ts` throws under `NODE_ENV=production` + any sandbox credential | unit | Thrown `ZodError` with OPS-04 violation message |
| **D7. IDOR baseline (SEC-01)** | Two seeded users; user B's session cannot read user A's consent/audit rows via any API route | integration | 404 responses for all cross-user reads; DB read log |
| **D8. Migration idempotence** | `drizzle-kit migrate` twice = identical schema; `CREATE EXTENSION IF NOT EXISTS pgcrypto` is safe to re-run | integration (testcontainers) | Schema snapshot comparison |
| **D9. SES bounce webhook idempotency (when wired in 01-04)** | Same SNS `MessageId` delivered twice writes one `webhook_events` row and one `ses_suppressions` row | integration | Row count assertions after 3 replays |
| **D10. Consent component reusability (Phase 2 readiness)** | `ConsentScreen` with scope `PLUGGY_CONNECTOR:123` renders Pluggy copy without any code change outside `consentScopes.ts` | unit (RTL) | Rendered DOM snapshot for both scopes |

### Sampling Rate

- **Per task commit:** `pnpm vitest run --changed` (Vitest only re-runs tests affected by the change set)
- **Per wave merge:** `pnpm vitest run` (full unit + integration)
- **Per plan merge:** `pnpm vitest run && pnpm playwright test` (full suite including e2e)
- **Phase gate (before `/gsd-verify-work`):** Full suite green + manual exercise of signup → login → password-reset → logout on a deployed `staging` Railway environment

### Wave 0 Gaps (all of Phase 1's test infrastructure — greenfield)

- [ ] `vitest.config.ts` — root config with `test.environment='node'`, `test.setupFiles=['tests/setup.ts']`, and a `@` → `src/` alias
- [ ] `playwright.config.ts` — `baseURL` points at `http://localhost:3000`, single `chromium` project for v1
- [ ] `tests/setup.ts` — registers `@testing-library/jest-dom`; spins up a testcontainers Postgres for integration tests
- [ ] `tests/fixtures/pii-corpus.ts` — corpus of real-shaped-but-fake PII strings (CPFs, emails, PIX descriptions) for scrubber tests
- [ ] `tests/unit/lib/crypto.test.ts`, `piiScrubber.test.ts`, `env.test.ts`, `logger.test.ts`
- [ ] `tests/unit/components/ConsentScreen.test.tsx`
- [ ] `tests/integration/auth/*.test.ts` (signup, login, logout, passwordReset, rateLimit)
- [ ] `tests/integration/security/idor.test.ts`, `cookies.test.ts`
- [ ] `tests/integration/lgpd/signupConsent.test.ts`
- [ ] `tests/integration/observability/sentry.test.ts`
- [ ] `tests/integration/db/migrate.test.ts` (testcontainers)
- [ ] `tests/e2e/auth/login.spec.ts`
- [ ] Framework install: `pnpm add -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @playwright/test testcontainers` + `pnpm dlx playwright install chromium`

---

## Security Domain

Security enforcement is enabled by default (no opt-out in `config.json`). Phase 1 establishes patterns every subsequent phase inherits.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Auth.js v5 credentials provider + argon2 + rate limiting + account lockout + CAPTCHA after 2nd failure |
| V3 Session Management | yes | Database-backed sessions via `@auth/drizzle-adapter`; HttpOnly + Secure + SameSite=Lax cookies; rotate on privilege change |
| V4 Access Control | yes (SEC-01 baseline) | `requireSession()` helper at the top of every route; every Drizzle query includes `AND user_id = $session.user.id`; 404 (not 403) for cross-user access |
| V5 Input Validation | yes | Zod v4 schemas for all request bodies + search params; strict parsing (`.strict()` for unknown-key rejection on auth endpoints) |
| V6 Cryptography | yes | `argon2id` for passwords (OWASP-recommended params); AES-256-GCM for CPF (helper in `lib/crypto.ts`); HMAC-SHA-256 with server-side pepper for CPF uniqueness hash; `crypto.randomBytes(32)` for reset tokens; argon2-hashed reset-token storage |
| V7 Error Handling & Logging | yes | `piiScrubber` applied at Sentry + logger + audit_log metadata; structured JSON; no raw email in `audit_log.metadata` for login failures; 30-day log retention |
| V9 Communications | yes (Railway TLS) | Railway auto-terminates TLS; `NEXTAUTH_URL=https://...` enforces secure cookie flag; HSTS via Next.js `headers()` config (1 year) |
| V10 Malicious Code | N/A Phase 1 | (Relevant once LLM prompts are in Phase 3) |
| V13 API Security | yes | POST-only for state-changing routes; CSRF via Auth.js's CSRF token for credentials submission; Next.js server actions ship with origin checks by default |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account enumeration via signup ("email already in use" response differs from "success") | Information disclosure | Same-shape response whether the email exists or not; only differentiate on the confirmed-account side via the email itself |
| Account enumeration via password reset | Information disclosure | D-08: duplicate in-window requests silent-ignored; response identical regardless of user existence |
| Timing attack on login | Information disclosure | Always run `argon2.verify` against a precomputed hash if the user is not found (const-time equalization); alternatively rely on the built-in argon2 timing variance being dwarfed by TLS jitter |
| Session fixation | Spoofing | Auth.js rotates the session token on sign-in; rotate also on password change (explicit `DELETE FROM sessions WHERE user_id` then new session via `signIn`) |
| CSRF | Spoofing / Tampering | Auth.js built-in CSRF token; Next.js server-action origin check |
| SQL injection | Tampering | Drizzle prepared statements (no raw SQL string concatenation); `sql`` `` template tag escapes parameters |
| IDOR on consent / audit / DSR rows | Elevation of privilege | `AND user_id = $session` on every query; integration test (SEC-01 coverage) |
| Log injection via `\n` in user input | Tampering | `pino` encodes strings as JSON; newlines are escaped. Still: never interpolate raw user input into log *messages*, only into `meta` |
| ReDoS in the `piiScrubber` regexes | DoS | The PII regexes are linear-time by construction (no nested `*`/`+` alternations); add a length cap (`input.slice(0, 10_000)`) as a belt-and-suspenders guard |
| Timing attack on password-reset-token verification | Information disclosure | argon2 verify is constant-time over its own work; token lookup is by `UNIQUE(token_hash)` so no scan |
| Webhook replay (SES) | Tampering / DoS | SNS signature verification + `UNIQUE(source, event_id)` idempotency |

---

## Runtime State Inventory

Phase 1 is greenfield — this section is included for process completeness, but every category is empty.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no existing data stores | N/A |
| Live service config | None — no existing Railway project, Sentry project, or SES domain | Creation is in-scope (01-01, 01-04) |
| OS-registered state | None | N/A |
| Secrets/env vars | None — Railway project not yet created | All env vars defined fresh in 01-01 / 01-04 |
| Build artifacts | None — no `package.json`, no `node_modules`, no `dist/` | First build in 01-01 |

**Nothing found in any category — verified by `ls .` on `web/` showing only `.claude/`, `.git/`, `.planning/`, `CLAUDE.md`.**

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node 20 LTS | All services (argon2 prebuild target) | ✗ (host) / ✓ (Railway container) | 20.x | Node 22 LTS (also works; Railway supports both) |
| pnpm | All services | ✓ (typical dev box) / ✓ (Railway native) | 9.x | npm (slower, more noisy) |
| PostgreSQL 16 | App, pg-boss | ✓ (Railway managed) | 16.x | PG 15 also works for Drizzle + pg-boss |
| Docker / testcontainers | Integration tests | ✓ (typical dev box, Windows Docker Desktop) | any recent | Skip testcontainers; run a local Postgres service (but CI needs Docker) |
| AWS account with SES | 01-04 SES setup | [ASSUMED — to be provisioned by the user] | — | Fallback = defer SES to 01-04 completion with a manual step documented (e.g., SendGrid EU is NOT acceptable — no BR region and outside LGPD-preferred residency) |
| Cloudflare account (Turnstile) | 01-02 CAPTCHA | [ASSUMED — to be provisioned] | — | hCaptcha (EU-hosted) as a secondary option; invisible reCAPTCHA disqualified (US data plane) |
| Railway account with `sa-east-1` access | All services | [ASSUMED — to be verified in 01-01 task 1] | — | **NO VIABLE FALLBACK within the phase scope** — if Railway doesn't offer `sa-east-1` at project creation, planner must escalate and consider GCP Cloud Run `southamerica-east1` + Cloud SQL (scope change) |
| Sentry account, EU data plane | 01-01 init, 01-04 full wiring | [ASSUMED — to be provisioned] | — | GlitchTip self-hosted (adds ops burden); acceptable if Sentry DPA is rejected by legal |

**Missing dependencies with no fallback:**
- Railway `sa-east-1` region availability is the single remaining runtime blocker. Planner must front-load verification as the first task of plan 01-01.

**Missing dependencies with fallback:**
- All others have documented fallbacks.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | Custom PBKDF2 / bcrypt wrapper / "fast" alternative | `argon2` (node-native) or `@node-rs/argon2` | OWASP 2025 recommendation; memory-hard; handles salt + params internally |
| AES-256-GCM | Hand-written cipher wrapper | `node:crypto` `createCipheriv('aes-256-gcm', …)` with 12-byte IV + 16-byte auth tag | Standard library; constant-time auth tag check; well-audited |
| CPF validation | Manual check-digit implementation | `@brazilian-utils/brazilian-utils` `isValid` | Battle-tested; rejects test CPFs (all-zero etc.) |
| Session management | Custom JWT + DB combo | Auth.js v5 + `@auth/drizzle-adapter` (database strategy) | Server-side revocation is the whole reason for AUTH-03 |
| Rate limiting algorithm | Token-bucket from scratch | Sliding-window Postgres counter (D-05) or `rate-limiter-flexible` | Our SLA is coarse (minute-granularity); a 15-min bucket is simpler and sufficient |
| CAPTCHA | Custom image challenge | Cloudflare Turnstile (D-07) | Zero-cost, invisible for real users, first-class EU data posture |
| PII regex scrubbing | Per-site ad-hoc regex | `lib/piiScrubber.ts` with a composable `Rule<T>` pipeline | Every call site writes the same thing; centralization eliminates drift |
| Sentry PII redaction | Custom Sentry transport | `beforeSend` + `piiScrubber` | Official Sentry extension point; synchronous; simple |
| Structured logger | `console.log` JSON by hand | `pino` | 50k+ msg/sec; JSON-native; Node-only (edge wrapper provided) |
| Form state | Hand-rolled React state | React Hook Form + Zod resolver | 10× less ceremony; Zod schema doubles as the API validator |
| Email templating | String interpolation into `<html>` | React Email components + `@react-email/render` | Type-safe variables, testable, preview server at dev time |
| SNS signature verification | Manual OpenSSL | `sns-validator` / official AWS SDK helper | Signature + cert-chain verification is fiddly; one-line with a library |

---

## Common Pitfalls (Phase 1-specific)

### Pitfall 1: `next-auth` stable vs `next-auth@beta`

**What goes wrong:** `pnpm add next-auth` resolves to `4.24.14` (Auth.js v4), which is incompatible with `@auth/drizzle-adapter@1.11`. The project boots but every auth call fails with adapter-shape mismatches.
**Why it happens:** Auth.js v5 is still tagged `beta` on npm as of April 2026.
**How to avoid:** `pnpm add next-auth@beta` — the tag is load-bearing. Pin to a specific beta (`5.0.0-beta.31`) once stable, or track the beta range with `^5.0.0-beta`.
**Warning signs:** Adapter returns `undefined` for sessions; `session.strategy` config is silently ignored.

### Pitfall 2: `@brazilian-utils/br-validations` doesn't exist

**What goes wrong:** STACK.md specifies a sub-package that is not published. `pnpm install` fails; planner wastes time hunting.
**How to avoid:** Use `@brazilian-utils/brazilian-utils@^2.3` directly. API: `isValid(cpf)`, `format(cpf)` imported from the package root.
**Warning signs:** 404 from npm registry.

### Pitfall 3: Argon2 native-module build breaks on Railway

**What goes wrong:** Occasionally the `argon2` npm prebuild is missing for a given Node + glibc combo, and the install falls back to `node-gyp` which fails on Railway's slimmer build containers.
**How to avoid:** Pin `"argon2": "^0.44.0"` (has broad prebuilds) and Node 20 LTS. If that fails, swap to `@node-rs/argon2` — pure Rust prebuilds, same API surface.
**Warning signs:** Build log shows `node-gyp` attempting to compile; deploy takes > 5 minutes.

### Pitfall 4: Auth.js `accounts` table collides with Pluggy `accounts`

**What goes wrong:** The Auth.js adapter schema includes an `accounts` table (for OAuth providers). Phase 2 introduces an `accounts` table for Pluggy bank accounts. If the Phase-1 schema uses the default name, Phase 2 needs a destructive rename.
**How to avoid:** Rename the Auth.js adapter's table at Phase-1 schema definition — use `pgTable('accounts_oauth', …)` and pass `accountsTable: accounts_oauth` to `DrizzleAdapter`.
**Warning signs:** None if caught at Phase-1 schema definition time; catastrophic rename migration if not.

### Pitfall 5: Sentry `beforeSend` runs synchronously; `async` throws are swallowed

**What goes wrong:** `beforeSend` is documented as synchronous. Writing `async beforeSend` or `await` inside it causes Sentry to send the *unscrubbed* event (the Promise is discarded). LGPD-06 silently violated.
**How to avoid:** Keep `piiScrubber` synchronous (it is — pure regex + object traversal). Never add async logic inside `beforeSend`. Test by returning a sentinel and asserting it's visible.
**Warning signs:** Sentry events in the EU dashboard still contain CPF / email strings.

### Pitfall 6: Edge runtime can't run `argon2` or `node:crypto.createCipheriv`

**What goes wrong:** Auth routes default to the node runtime in App Router, BUT middleware runs on the edge. Importing `lib/crypto.ts` or `argon2` from middleware silently crashes the runtime.
**How to avoid:** Keep auth in route handlers with `export const runtime = 'nodejs'` explicitly declared. Middleware limited to cookie presence / routing — no crypto.
**Warning signs:** Deployment succeeds; runtime error only on cold start.

### Pitfall 7: Next.js 16 `instrumentation.ts` + env assertion order

**What goes wrong:** If `lib/env.ts` is imported from `instrumentation.ts` AFTER other side-effect imports, those earlier imports may have already read (bad) env values.
**How to avoid:** `import "@/lib/env"` MUST be the first statement in `instrumentation.ts`. Same for the worker entrypoint.
**Warning signs:** Production container starts serving traffic and only later logs a Zod error.

### Pitfall 8: Drizzle `push` in production

**What goes wrong:** `drizzle-kit push` is convenient locally but does not produce migration files; running it against Railway Postgres silently drops / alters columns without a trail.
**How to avoid:** Use `generate` + `migrate` only. Add a CI check that errors if `drizzle-kit push` appears in any script.
**Warning signs:** Schema changes in a deploy without a corresponding `src/db/migrations/*.sql` file.

### Pitfall 9: Windows dev + `postgres`/`argon2` paths

**What goes wrong (from CLAUDE.md — Windows dev):** Native modules occasionally build differently on Windows; Docker Desktop can add path translation surprises for testcontainers.
**How to avoid:** Document in `README.md` that local dev requires Docker Desktop running, `WSL2` backend, and `pnpm` not `npm`. Use `.nvmrc` to pin Node version. Keep all shell scripts Bash-compatible (Git Bash on Windows) — no PowerShell-specific commands.
**Warning signs:** `testcontainers` fails with ECONNREFUSED on Windows.

---

## Project Constraints (from CLAUDE.md)

The `./CLAUDE.md` and `~/.claude/CLAUDE.md` directives are authoritative. Extracted:

- **Language:** US-English for documentation, code (comments, variable names, messages), and commits.
- **Naming conventions:**
  - Classes / Structs: `PascalCase` (`AuthShell`, `ConsentScreen`, `PiiScrubber`)
  - Functions: `camelCase` (`requireSession`, `scrubObject`, `verifyTurnstile`)
  - Variables / member variables: `snake_case` (`user_id`, `password_hash`, `cpf_enc`)
  - Local variables: `camelCase`
  - Constants: `UPPER_SNAKE` (`MAX_LOGIN_ATTEMPTS`, `RATE_LIMIT_WINDOW_MS`)
  - Source files: `PascalCase.ts` / `.tsx` (`AuthShell.tsx`, `PiiScrubber.ts`)
  - Folders: `snake_case` (`src/lib/`, `src/db/schema/`, `src/jobs/`, `src/components/auth/`)
  - Acronyms always uppercase: `CPF`, `CNPJ`, `API`, `DB`, `SQL`, `JSON`, `XML`, `HTTP`, `HTTPS`, `AWS`, `GCS`, `SFTP`, `WASM`, `OCR`, `BPMN`, `DMN`, `FEEL`, `RPA`
- **Commit template:**

  ```
  <type>(<scope>): <subject>

  <description>

  <plan XX><phase XX><task XX>
  ```

  Types: `docs`, `specs`, `plan`, `reqs`, `test`, `ide`, `deploy`, `feature`, `refactor`, `review`, `format`, `fix`.

- **Diagrams:** Mermaid.

- **GSD workflow:** Never edit `.planning/*.md` directly; use slash commands. All planning artifacts are committed.

- **Tech-stack authority:** STACK.md is authoritative (modulo the two verified corrections above: `next-auth@beta` and `@brazilian-utils/brazilian-utils`).

- **Pitfall lockdowns:** P1 dedup, P2 item states, P3 webhook auth, P4 encrypt item IDs (applies to CPF pattern in Phase 1), P5 async sync, P6 never trust Pluggy category, P7 transfer detection, P8 fatura detection, P11 per-source consent, P12 complete deletion, P13 PII scrubbing, P14 LLM cross-border, P22 NFS-e, P26 IDOR, P28 CPF validation + encryption.

**Phase-1 directive compliance check:**
- ✓ Naming: `users.cpf_enc` / `users.cpf_hash` (snake_case members); `PiiScrubber.ts` (PascalCase file); `lib/crypto.ts` (folder snake_case, file lowercase is fine for `lib/` utilities per common Next.js idiom — planner may elect `Crypto.ts` for strict adherence).
- ✓ Acronyms: `CPF`, `JSON`, `HTTP`, `HTTPS`, `AWS`, `SES`, `SNS`, `SES` all uppercase in code and docs.
- ✓ Language: everything EN_US.
- ✓ Commits: Phase 1 plans will use `<plan 01><phase 01><task NN>` footer.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Railway `sa-east-1` region is still offered at project creation as of April 2026 | Implementation Playbook 01-01, Environment Availability | HIGH — no viable in-phase fallback; planner must escalate. STATE.md already flags this; verification is the first task of 01-01. [ASSUMED — based on Railway's public region list through mid-2025] |
| A2 | Railway AWS SES `sa-east-1` is a supported region at account creation (not just a data-residency claim in marketing) | Plan 01-04, D-09 | MEDIUM — if not, fallback is still SES (different account in `sa-east-1`); no scope change. [ASSUMED — SES is GA in `sa-east-1` per AWS's public region table] |
| A3 | Cloudflare Turnstile's data plane is LGPD-acceptable (challenge happens at Cloudflare edge, Turnstile itself does not persist identifiable user data) | D-07, Security Domain | LOW — Cloudflare publishes a DPA and DPA-ready flow; CONTEXT.md already selected Turnstile. [ASSUMED — Cloudflare's published LGPD posture as of mid-2025] |
| A4 | Sentry EU (`de.sentry.io`) accepts application PII in breadcrumbs / messages *when scrubbed by `beforeSend`* — i.e., the EU plane's DPA covers scrubbed error metadata | 01-04, Security Domain | LOW — this is Sentry's standard advertised behavior; CONTEXT.md has chosen Sentry. Mitigation is `piiScrubber` itself. [ASSUMED — Sentry's published data-residency posture] |
| A5 | Next.js 16.2 `instrumentation.ts` still runs once per runtime at cold start; the schema has not changed since Next.js 15 | 01-04 implementation | LOW — Next.js stable behavior documented through 15; 16 preserved it. [ASSUMED — verify at first Next.js 16 dev run that `instrumentation.ts` fires] |
| A6 | `argon2@0.44.0` publishes prebuilt binaries for Node 20 + glibc 2.35 (Railway's base image) | 01-02 landmine #2 | MEDIUM — if missing, fall back to `@node-rs/argon2`. [ASSUMED — verify at first `pnpm install` on Railway] |
| A7 | pg-boss v12 requires only Postgres 13+ (no extensions beyond `pgcrypto` for `gen_random_uuid()`); creates its own schema `pgboss` on `boss.start()` | 01-01 landmine | LOW — pg-boss README confirms. [VERIFIED: pg-boss GitHub README] |
| A8 | The `@auth/drizzle-adapter` `accountsTable` override successfully accepts a table named `accounts_oauth` so we can avoid collision with Phase 2's Pluggy `accounts` table | Pitfall #4, schema sketch | LOW — adapter docs show per-table override. [CITED: https://authjs.dev/getting-started/adapters/drizzle] |
| A9 | AWS SES production-access review is typically 24–48 h for a legitimate transactional use case | D-12, Environment Availability | LOW — AWS's own estimate. [CITED: AWS SES docs — https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html] |
| A10 | Drizzle's migration workflow (`generate` + `migrate`) is idempotent when run during Railway's predeploy step | 01-01 migration workflow | LOW — Drizzle docs and widespread community use confirm. [CITED: https://orm.drizzle.team/docs/migrations] |

If any of A1–A10 is wrong at verification time, the planner should update PLAN.md with the appropriate fallback from Environment Availability / Common Pitfalls and re-commit before execution starts.

---

## Open Questions / Blockers for Planner

1. **Do we own `portalfinance.app`?** D-11 hardcodes this sender. If the apex is not yet registered, DNS setup (MX, SPF, DKIM, DMARC) becomes a dependency on registration completing — planner should surface this as the first task of 01-04 alongside the SES production-access request. If not yet owned: halt at the end of 01-02 and escalate.
   - What we know: CONTEXT.md specifies the domain; STATE.md does not note ownership.
   - What's unclear: whether the domain is registered and the DNS zone is under our control.
   - Recommendation: The planner adds a "verify apex domain ownership and nameservers" subtask at the top of 01-04. If not owned, 01-04 splits into a blocking subtask before SES work can proceed.

2. **Where does the ToS / Privacy Policy live?** LGPD-01 requires a version-hashable document. Is legal counsel writing it, or do we ship a template? The `consent_version` column depends on this existing.
   - What we know: CONTEXT.md D-16 writes `ACCOUNT_CREATION` consent with a version.
   - What's unclear: the actual content.
   - Recommendation: Include a skeleton `docs/legal/terms-v1.md` and `docs/legal/privacy-v1.md` in 01-03 with a TODO for legal review. Hash the markdown at build time into `consentVersions.ts`. Pre-launch gate for legal review lands in Phase 6.

3. **CPF_HASH_PEPPER vs ENCRYPTION_KEY — same secret or different?** Recommendation in the research is HMAC with a separate pepper to resist rainbow attacks if the DB leaks but the key is unchanged.
   - What we know: neither CONTEXT.md nor STACK.md specifies.
   - Recommendation: two distinct env vars (`ENCRYPTION_KEY` and `CPF_HASH_PEPPER`). Document the rationale in `docs/ops/encryption-key-rotation.md`.

4. **Demo dashboard data source (D-03 / UI-SPEC §2.10).** Is the sample data a static constant file (`src/lib/demoData.ts`), or should it be persisted to the DB for the demo user? UI-SPEC says "hard-coded constants" — confirm this is final (no per-user demo variation).
   - What we know: UI-SPEC §2.10 hardcodes the numbers.
   - Recommendation: Static constants in `src/lib/demoData.ts`. Render the demo dashboard purely client-side for the first post-signup session; real dashboard lands in Phase 4.

5. **Manifest `public/logo.svg` — who creates it?** UI-SPEC §2.1 references `public/logo.svg` at 32px height and as the PWA manifest base (Phase 4). Phase 1 needs it for `AuthShell`.
   - Recommendation: Plan 01-01 includes a "placeholder logo SVG" task (simple wordmark) with a note to replace during Phase 4 PWA polish.

---

## Code Examples

### Drizzle schema for `users` + `user_consents` + `sessions` (Phase 1 baseline)

```typescript
// src/db/schema/users.ts
import { pgTable, uuid, text, timestamp, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType: () => "bytea",
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  email_verified_at: timestamp("email_verified_at", { withTimezone: true }),
  password_hash: text("password_hash").notNull(),
  cpf_hash: bytea("cpf_hash"),    // nullable in Phase 1; NOT NULL in Phase 2
  cpf_enc: bytea("cpf_enc"),      // nullable in Phase 1; NOT NULL in Phase 2
  subscription_tier: text("subscription_tier").notNull().default("paid"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});
```

[CITED: Drizzle customType for bytea — https://orm.drizzle.team/docs/custom-types]

### Signup server action with transactional consent write

```typescript
// src/app/(auth)/signup/actions.ts
"use server";
export const runtime = "nodejs";

import argon2 from "argon2";
import { z } from "zod";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { db } from "@/db";
import { users, user_consents, audit_log } from "@/db/schema";
import { SignupSchema } from "@/lib/validation";
import { versions } from "@/lib/consentVersions";
import { logger } from "@/lib/logger";

export async function signupAction(formData: FormData) {
  const parsed = SignupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "invalid" };

  const { email, password } = parsed.data;
  const password_hash = await argon2.hash(password);
  const hdrs = await headers();
  const ip_address = hdrs.get("x-forwarded-for")?.split(",")[0] ?? null;
  const user_agent = hdrs.get("user-agent") ?? null;

  await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: email.toLowerCase(), password_hash }).returning();
    await tx.insert(user_consents).values({
      user_id: u.id,
      scope: "ACCOUNT_CREATION",
      action: "GRANTED",
      consent_version: versions.ACCOUNT_CREATION,
      ip_address,
      user_agent,
      granted_at: new Date(),
    });
    await tx.insert(audit_log).values({
      user_id: u.id,
      actor_type: "USER",
      action: "signup",
      ip_address,
      user_agent,
    });
  });

  logger.info({ event: "signup_success" }, "user signed up");
  await signIn("credentials", { email, password, redirect: false });
  return { ok: true };
}
```

### `instrumentation.ts` (OPS-04 boot assertion)

```typescript
// instrumentation.ts (project root)
export async function register() {
  // MUST be first — ensures env validation runs before any side-effect module
  await import("@/lib/env");
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `next-auth` v4 config on `pages/api/auth/[...nextauth]` | `next-auth@5` (Auth.js v5) with `auth()` helper + `handlers.GET`/`handlers.POST` in App Router | Auth.js v5 beta GA'd through 2024–2025 | Cleaner RSC integration; database sessions supported via adapters |
| Prisma + `PrismaClient` | Drizzle ORM + `postgres` driver | 2024 onward | No binary engine; explicit SQL; better fit for finance |
| `next-pwa` (abandoned) | `@serwist/next` (Phase 4, not Phase 1) | 2024 | Actively maintained; cleaner Next.js 15/16 integration |
| Manual CSRF tokens | Auth.js built-in CSRF + Next.js server-action origin checks | Next.js 14+ stable | No handwritten CSRF middleware required |
| reCAPTCHA v2 | Cloudflare Turnstile | 2022 onward | Zero-cost, invisible, EU-compatible |
| Inngest / Temporal cloud for jobs | pg-boss in-Postgres | Disqualified by LGPD BR residency | Zero new infra; stays in `sa-east-1` |
| Nodemailer + SMTP | `@aws-sdk/client-ses` v3 + React Email | AWS SDK v3 + React Email mid-2024 | Type-safe, modular, first-class templating |

**Deprecated / outdated:**
- `next-pwa` — not used; `@serwist/next` is the v1 choice (Phase 4).
- `drizzle-kit push` for production schema changes — use `generate` + `migrate`.
- JWT sessions for Portal Finance — impossible to invalidate server-side (AUTH-03 would fail).
- Plain SHA-256 for CPF uniqueness without a pepper — rainbow-attackable under a DB leak scenario.

---

## Sources

### Primary (HIGH confidence)

- **npm registry** — version verification for every package in Stack Verification, run 2026-04-22 via `npm view` (see table above) [VERIFIED]
- **Next.js 16 App Router documentation** — https://nextjs.org/docs/app; `instrumentation.ts`, server actions, runtime declaration, cookies API [CITED]
- **Auth.js v5 documentation** — https://authjs.dev/getting-started/adapters/drizzle; Credentials provider + database sessions + Drizzle adapter [CITED]
- **Drizzle ORM migrations** — https://orm.drizzle.team/docs/migrations; `generate` + `migrate` workflow [CITED]
- **pg-boss v12 README** — https://github.com/timgit/pg-boss; schema creation, singleton keys, cron jobs [CITED]
- **Sentry Next.js filtering** — https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/filtering/; `beforeSend` synchronous semantics [CITED]
- **Sentry EU data residency** — https://docs.sentry.io/product/accounts/choose-your-data-center/; `de.sentry.io` ingestion routing [CITED]
- **OWASP Password Storage Cheat Sheet** — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html; argon2id parameters [CITED]
- **Cloudflare Turnstile server-side validation** — https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ [CITED]
- **AWS SES production access** — https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html [CITED]
- **Internal planning artifacts** — CONTEXT.md, UI-SPEC.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, STACK.md, ARCHITECTURE.md, PITFALLS.md [VERIFIED: read-through of all files]

### Secondary (MEDIUM confidence)

- **Railway regions** — public region listings through mid-2025 confirming `sa-east-1` [ASSUMED for April 2026; verification deferred to 01-01 task 1]
- **React Email + AWS SDK v3 SES** — widespread community docs / patterns through 2024–2025 [CITED]
- **`@brazilian-utils/brazilian-utils` API** — npm page + GitHub README [CITED]

### Tertiary (LOW confidence — flagged for execution-time re-verification)

- Railway `sa-east-1` availability at project creation as of April 2026 — [ASSUMED A1]
- argon2 prebuild availability on Railway's current build container — [ASSUMED A6]
- Next.js 16.2's `instrumentation.ts` semantic stability vs 15 — [ASSUMED A5]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package verified against the live npm registry with version as of 2026-04-22; two STACK.md inaccuracies corrected (Auth.js v5 install tag; `@brazilian-utils/brazilian-utils` canonical name).
- Architecture: HIGH — three-service Railway topology is explicit in ARCHITECTURE.md Pattern 5; migration strategy is standard Drizzle doctrine; schema sketch exists in ARCHITECTURE.md and is referenced directly.
- Pitfalls: HIGH — all relevant PITFALLS.md items mapped to Phase-1 mitigations with no cross-phase leakage; landmines called out per plan slice.
- Runtime/environment: MEDIUM — Railway region + SES prod access + Cloudflare Turnstile account are ASSUMED pending first-task verification.
- Validation architecture: HIGH — every phase requirement has an exact automated test command; Nyquist dimensions 1–10 defined with test shape and evidence.

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days — stack is stable; Railway region + Auth.js v5 stable-release are the two items most likely to change within this window)

---

## RESEARCH COMPLETE

**Phase:** 1 — Foundation & Identity
**Confidence:** HIGH (with two runtime-verification items documented and fallbacks provided)

### Key Findings

1. **STACK.md has two errors the planner MUST correct in PLAN.md**: (a) install Auth.js v5 via `next-auth@beta` (5.0.0-beta.31) not plain `next-auth` (which resolves to v4.24.14); (b) the real CPF validator package is `@brazilian-utils/brazilian-utils@2.3.0`, not the non-existent `@brazilian-utils/br-validations`.
2. **All remaining Phase-1 packages verified against the live npm registry** at their STACK.md-specified versions or newer — no additional install surprises expected.
3. **Plan sequencing locked**: 01-01 scaffolds Railway + Drizzle schema + Sentry SDK wiring (so boot-time errors during schema setup are captured with at least CPF-regex scrubbing); 01-02 lands Auth.js + `lib/crypto.ts` + rate-limit + Turnstile; 01-03 lands LGPD (ConsentScreen, consents, DSR stubs, piiScrubber); 01-04 closes observability + env assertion + SES prod-access + bounce webhook (which exercises the `webhook_events` idempotent-webhook pattern Phase 2 inherits).
4. **Two runtime-verification items remain**: Railway `sa-east-1` region availability at project creation (no viable fallback — front-load verification as first task of 01-01); AWS SES production-access review (24–48 h — kick off on day 1 of 01-04).
5. **Validation Architecture is complete**: 10 Nyquist dimensions, one automated test file per phase requirement, Vitest + Playwright + testcontainers as the test-framework trio, all Wave-0 gaps enumerated.

### File Created

`C:\Users\aless\git\PortalFinance\web\.planning\phases\01-foundation-identity\01-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | npm registry verification 2026-04-22; STACK.md corrections identified |
| Architecture | HIGH | ARCHITECTURE.md Pattern 5 + schema sketch directly applicable; migration workflow is standard Drizzle doctrine |
| Pitfalls | HIGH | PITFALLS.md items mapped; additional Phase-1-specific landmines surfaced in Common Pitfalls |
| LGPD scaffolding | HIGH | CONTEXT.md decisions D-01–D-19 all addressed; `user_consents` append-only schema with scope discriminated union tested for Phase-2 reuse |
| Runtime / deploy | MEDIUM | Railway region + SES prod access + argon2 prebuild are ASSUMED; fallbacks documented |
| Validation | HIGH | Every requirement has an automated test command; Wave-0 gap list is explicit |

### Open Questions for Planner

1. Domain ownership of `portalfinance.app` (blocks SES setup in 01-04).
2. ToS / Privacy Policy draft existence (needed for `consent_version` hash).
3. CPF_HASH_PEPPER vs ENCRYPTION_KEY — recommend two distinct env vars.
4. Logo SVG authoring for `AuthShell` + Phase-4 PWA manifest.

### Ready for Planning

Research complete. Planner can now create PLAN.md files for 01-01, 01-02, 01-03, and 01-04.
