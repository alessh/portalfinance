# Phase 1: Foundation & Identity - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the Railway `sa-east-1` deployment topology (three services: `web`, `worker`, `postgres`), the Drizzle-managed schema baseline, Auth.js v5 credentials authentication, LGPD scaffolding (consent, DSR skeleton, `piiScrubber`), and observability (Sentry EU + structured JSON logs). No Pluggy data flows yet — Phase 1 delivers identity and the cross-cutting foundation every subsequent phase depends on.

**Requirements in scope:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, LGPD-01, LGPD-05, LGPD-06, SEC-01, SEC-02, OPS-01, OPS-04.

</domain>

<decisions>
## Implementation Decisions

### Sign-up & First-Run UX

- **D-01:** Sign-up is a **single-page form** — email + password + consent checkbox on one screen. Inline client-side validation. No multi-step wizard.
- **D-02:** Email verification is **deferred** — sign-in works immediately after sign-up; a persistent nag banner requests verification. Email verification becomes **mandatory** before connecting the first Pluggy item (Phase 2) and before paid subscription checkout (Phase 5).
- **D-03:** First post-signup screen is a **demo dashboard populated with illustrative sample data**, with the headline "this is what yours will look like — connect your bank to see real numbers." Directly mitigates P30 (value-before-bank-connection) and primes the user's mental model for the categorization differentiator.
- **D-04:** **CPF is NOT collected at sign-up.** CPF is collected + validated + AES-256-GCM encrypted at the first bank-connect step (Phase 2), on the same consent screen that gates Pluggy Connect.
  - **Requirement refinement needed:** AUTH-01 and Phase-1 Success Criterion #1 currently say "email + CPF + password at registration." Planner must update wording: sign-up captures email + password; CPF is captured + encrypted before any Pluggy item is created.
  - **Schema implication:** `users.cpf_hash` and `users.cpf_enc` are nullable in Phase 1; a NOT-NULL constraint on both is introduced by Phase 2 migration once the "CPF required before Pluggy connect" gate is in place.

### Authentication & Rate Limiting

- **D-05:** Rate-limit counters and lockout state are stored in **Postgres** (same DB as the application). A dedicated `auth_rate_limits` table keyed on `(identifier, bucket_window)` with a pg-boss cron sweeper for expired rows. No Redis / Upstash in Phase 1.
- **D-06:** Login failure policy = **5 failures per 15-minute sliding window → 15-minute lockout + unlock email**. Matches AUTH-05 literally. Successful login resets the counter. Unlock email contains a single-use, time-limited link.
- **D-07:** **CAPTCHA is shown after the 2nd failed login attempt** (P29). Vendor: **Cloudflare Turnstile** (invisible / managed challenge, EU/global plane compatible with LGPD posture, free tier sufficient for v1).
- **D-08:** Password-reset rate limit = **3 requests / hour / email + a stricter per-IP cap (10 / hour / IP)**. Duplicate in-window requests are silent-ignored so the response cannot be used to enumerate accounts.

### Email / Transactional Provider

- **D-09:** **AWS SES `sa-east-1`** is the transactional email provider for Phase 1 and forward. Strongest LGPD residency story (matches Pluggy/ASAAS/Sentry-EU pattern). Used for password-reset, account-unlock, DSR acknowledgment, and later Phase 2 re-auth + Phase 5 billing notifications.
- **D-10:** **Email templates authored as React Email components in-repo** (`src/emails/*.tsx`), rendered to HTML at send time via `@react-email/render`. Type-safe variables; unit-testable; templates live with the code.
- **D-11:** Sender address = **`no-reply@portalfinance.com.br` (apex domain)**. SPF + DKIM (SES-managed) + DMARC configured on the apex.
- **D-12:** **Request SES production access during Phase 1 plan `01-04` (Observability)**. AWS review typically takes 24–48 hours — the plan must initiate the request early enough that dev/staging emails reach real addresses before the phase completes.
- **D-13:** **DMARC policy starts at `p=none` with `rua` aggregate reporting** — monitoring only in Phase 1. Upgrade to `p=quarantine` → `p=reject` during Phase 6 LGPD hardening once reports are clean.
- **D-14:** Use the **AWS SDK v3 SES client** (`@aws-sdk/client-ses`), not SMTP / Nodemailer. Native TypeScript, IAM credentials, better retry handling.
- **D-15:** Bounce / complaint handling = **SNS topic → webhook → `webhook_events` + pg-boss worker**. Reuses the same idempotent webhook-ingestion pattern that Pluggy and ASAAS will use in Phases 2 and 5. Worker writes suppression rows and refuses sends to suppressed addresses.

### LGPD Consent, DSR, and PII

- **D-16:** **Signup-time consent** writes a real `user_consents` row with `scope='ACCOUNT_CREATION'`, `action='GRANTED'`, IP, User-Agent, and timestamp — covers ToS + Privacy Policy + LGPD account-processing legal basis. Also ships a **reusable `ConsentScreen` component** (used for Pluggy Connect consent in Phase 2) exercised by a unit test (per Success Criterion #5).
- **D-17:** **DSR skeleton scope** = `dsr_requests` schema + `/api/privacy/export` and `/api/privacy/delete` route stubs that create a `dsr_requests` row, enqueue a pg-boss job, and trigger an SES acknowledgment email. The Phase 1 worker only writes `status='PENDING'` and tracks SLA; full export/deletion execution ships in Phase 6. Acknowledgment email mentions the 15-day statutory window.
- **D-18:** `piiScrubber` is **one utility with pluggable rules** (`lib/piiScrubber.ts`, `Rule<T>` pattern). Initial rules: CPF regex, Brazilian-name PIX patterns, email, phone, account numbers, token-like strings. Consumed from three call sites in Phase 1 (Sentry `beforeSend`, structured-log wrapper) and one in Phase 3 (LLM prompt builder). Unit-tested against a corpus of fake-but-real-shaped data.
- **D-19:** `audit_log` coverage in Phase 1 = **auth events only**: `signup`, `login_success`, `login_failure`, `logout`, `password_reset_requested`, `password_reset_completed`, `account_locked`, `account_unlocked`, `consent_granted`, `consent_revoked`. Later phases extend the event catalogue.

### Claude's Discretion (not explicitly asked)

- **Session strategy:** Database-backed sessions via `@auth/drizzle-adapter` (required by AUTH-03 server-side invalidation; JWT sessions can't be revoked).
- **Encryption key management:** Single master key from Railway env var in Phase 1 (`ENCRYPTION_KEY`), with a documented rotation procedure. No multi-key envelope / KMS integration in Phase 1 — the only encrypted field is `cpf_enc`, which is nullable until Phase 2. Revisit envelope/KMS pattern in Phase 6 hardening when `pluggy_item_id` and tokens are also encrypted.
- **Plan sequencing:** Keep ROADMAP's order (01-01 infra → 01-02 auth → 01-03 LGPD → 01-04 observability), but Sentry SDK installation + `beforeSend` scrubber wiring happens as the first task of 01-01 so boot-time errors during schema setup are captured. Full structured-log plumbing, SES prod-access request, and alert rules still live in 01-04.
- **Runtime sandbox/prod assertion (OPS-04):** A `lib/env.ts` module validates all env vars with Zod at boot; throws if `NODE_ENV='production'` and any of `PLUGGY_ENV`, `ASAAS_ENV`, `SENTRY_ENV` is `'sandbox'` / `'test'` / undefined. Boot fails fast before the HTTP server starts accepting requests.
- **Subscription tier default:** `subscription_tier` column defaults to `'paid'` on INSERT until Phase 5 flips the default to `'free'` (per Success Criterion #3).
- **Password strength:** Zod schema enforces min 10 chars, at least one number + one letter, disallows top-1000 common passwords. No complexity "must have special char" rules (HIBP-style).

### Requirement Refinements Flagged for Planner

- **AUTH-01:** Rewrite to "User can create an account with email and password. CPF is validated (check-digit) and stored AES-256-GCM-encrypted at first bank-connect (Phase 2); invalid or test CPFs are rejected at that gate."
- **Phase-1 Success Criterion #1:** Rewrite to "User can register with email + password, log in, and stay logged in across refresh. CPF is NOT collected at sign-up — its validation and encryption land in Phase 2."
- **Phase-1 Success Criterion #5:** Satisfied **plus** strengthened — signup-time consent row is written and audited (not only exercised by a unit test).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (always load)

- `.planning/PROJECT.md` — vision, constraints (BR residency, email + CPF + password auth, LGPD non-negotiable), key decisions table.
- `.planning/REQUIREMENTS.md` — Phase 1 v1 requirements: AUTH-01..06, LGPD-01, LGPD-05, LGPD-06, SEC-01, SEC-02, OPS-01, OPS-04 (§ Authentication & Identity, § LGPD & Consent, § Security & Authorization, § Operational Readiness).
- `.planning/ROADMAP.md` § Phase 1 — goal, depends-on (none), success criteria (#1–#6), plan list 01-01..01-04.

### Stack and architecture

- `.planning/research/STACK.md` — locked stack (Next.js 16, Drizzle 0.45, Auth.js v5, pg-boss 12, argon2, Zod v4, `@brazilian-utils/br-validations`, Sentry `@sentry/nextjs` ^10, AWS SDK v3 SES); disqualified services list (Supabase, Neon, Stripe, Clerk, Inngest/Trigger.dev, Prisma Accelerate, `next-pwa`); version-compatibility table.
- `.planning/research/ARCHITECTURE.md` § System Overview, § Recommended Project Structure, § Pattern 5 (Separate Worker Service), § Schema Sketch (`users`, `sessions`, `user_consents`, `webhook_events`, `audit_log`, `admin_access_log`, `subscriptions`, `dsr_requests`), § Build Order "Phase 1 — Foundation (vertical slice)" — informs Phase 1 schema and task decomposition.
- `.planning/research/PITFALLS.md` — targeted sections:
  - P4 (encrypt item IDs — applies to CPF at rest; same AES-256-GCM pattern)
  - P10 (sandbox/prod confusion — OPS-04 runtime assertion)
  - P11 (per-data-source consent — `user_consents` append-only)
  - P12 (complete deletion — skeleton in Phase 1)
  - P13 (PII in logs — `piiScrubber` + Sentry `beforeSend`)
  - P15 (DSR workflow — skeleton in Phase 1)
  - P26 (IDOR on endpoints — SEC-01)
  - P28 (CPF validation + encryption — Phase 2 when CPF is actually collected)
  - P29 (login rate limit + CAPTCHA after 2nd failure — AUTH-05, D-06/D-07)
  - P36 (observability from day 1 — OPS-01)

### Global conventions

- `C:\Users\aless\.claude\CLAUDE.md` — naming conventions (PascalCase classes, camelCase functions, snake_case variables, PascalCase source filenames, snake_case folders), acronym uppercase rules, commit template.
- `.\CLAUDE.md` (project) — repository-specific overrides, current position, current phase, critical pitfalls summary.

### External docs (downstream agents should fetch at plan/execute time via Context7 / WebFetch)

- Next.js 16 App Router — https://nextjs.org/docs/app
- Auth.js v5 (credentials provider + Drizzle adapter) — https://authjs.dev/
- Drizzle ORM — https://orm.drizzle.team/
- pg-boss v12 — https://github.com/timgit/pg-boss
- AWS SDK v3 `@aws-sdk/client-ses` — https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ses/
- Cloudflare Turnstile — https://developers.cloudflare.com/turnstile/
- React Email — https://react.email/docs
- Sentry Next.js (EU region) — https://docs.sentry.io/platforms/javascript/guides/nextjs/
- `@brazilian-utils/br-validations` — https://github.com/brazilian-utils/brazilian-utils

</canonical_refs>

<code_context>
## Existing Code Insights

**The `web/` working directory is greenfield — no `src/`, no `package.json`, no Drizzle schema, no Next.js app yet.** Only `.claude/`, `.git/`, `.planning/`, and `CLAUDE.md` exist.

### Reusable Assets

- None. Phase 1 creates the initial codebase.

### Established Patterns

- None (greenfield). Phase 1 **establishes** the patterns that every subsequent phase will follow:
  - Three-service Railway topology (`web`, `worker`, `postgres`) with the same repo deployed twice under different entrypoints (`start:web`, `start:worker`).
  - `src/db/schema/*.ts` one file per domain aggregate; migrations under `src/db/migrations/` via drizzle-kit.
  - `src/services/*/` pure-TypeScript domain services; no HTTP calls; testable in isolation.
  - `src/jobs/*Worker.ts` one file per pg-boss worker; `src/jobs/boss.ts` is the client singleton.
  - `src/lib/*` cross-cutting utilities: `auth.ts`, `crypto.ts`, `piiScrubber.ts`, `env.ts`, `logger.ts`.
  - Webhook route handlers verify auth → idempotent insert into `webhook_events` → `boss.send()` → return 200 in < 200 ms. Phase 1 ships the `webhook_events` table and the SES-bounce webhook as the first real consumer.

### Integration Points (seeded by Phase 1 for later phases)

- `users`, `sessions` → consumed by every authenticated route.
- `user_consents` → consumed by Phase 2 Pluggy Connect gate, Phase 6 DSR delete workflow.
- `webhook_events` → consumed by Phase 2 (Pluggy), Phase 5 (ASAAS), Phase 1 itself (SES bounces).
- `subscriptions` skeleton + `subscription_tier` on `users` → consumed by Phase 5 tier enforcement and Phase 2 free/paid sync cooldown.
- `audit_log` → consumed by Phase 6 admin access logging.
- `dsr_requests` + `piiScrubber` + `ConsentScreen` component → consumed by Phase 2 (Pluggy consent) and Phase 6 (DSR execution).
- `lib/env.ts` Zod-validated env loader → consumed by every service; enforces OPS-04 sandbox/prod assertion at boot.
- `lib/crypto.ts` AES-256-GCM helper → consumed by Phase 2 `pluggy_item_id` encryption, using the same key-management pattern documented in Phase 1.

</code_context>

<specifics>
## Specific Ideas

- Demo dashboard (D-03) should use **plausible Brazilian middle-class numbers** (rent R$ 2.8k, mercado R$ 1.2k, iFood R$ 450, PIX recebido de salário R$ 6.5k) — not abstract placeholder values. Numbers inform the user that Portal Finance "understands" Brazilian spending shape.
- `ConsentScreen` component (D-16) should accept a `scope` prop (`ACCOUNT_CREATION` in Phase 1, `PLUGGY_CONNECTOR:{id}` in Phase 2) so Phase 2 reuses it without modification.
- Unlock email (D-06) and password-reset email (AUTH-04) share a visual template with a clear "wasn't me" CTA that suspends the account and forces a password reset.

</specifics>

<deferred>
## Deferred Ideas

- **Social authentication** (Google / Apple) — out of scope per PROJECT.md; tracked as v1.x `AUTH-EXT-01`.
- **Multi-key envelope encryption / KMS** — Phase 1 uses a single master key. Revisit in Phase 6 hardening when `pluggy_item_id` and tokens are also at rest.
- **DMARC quarantine / reject** — starts at `p=none` (D-13); tightened in Phase 6.
- **Broader audit_log coverage** — Phase 1 logs auth events only (D-19); Phases 2–6 extend.
- **Encryption key rotation tooling** — documented procedure in Phase 1; automated rotation job deferred to Phase 6.
- **Password-strength meter UI** — Zod enforces minimum policy server-side; client-side strength meter is a polish item for Phase 4 or later.
- **Per-category granular consent toggles** (analytics, marketing) — Phase 1 ships a single consent bundle for account creation; granular toggles deferred.

</deferred>

---

*Phase: 01-foundation-identity*
*Context gathered: 2026-04-22*
