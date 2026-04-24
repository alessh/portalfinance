# Phase 1: Foundation & Identity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 01-foundation-identity
**Areas discussed:** Sign-up & first-run UX, Rate-limit & lockout infra, Email / transactional provider, Consent & DSR skeleton depth

---

## Sign-up & First-Run UX

### Q1 — How should the sign-up flow be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Single-page form | All fields (email, CPF, password, consent checkbox) on one screen. Fastest, lowest abandonment for motivated users. Inline CPF check-digit validation. | ✓ |
| Two-step: email+password → CPF+consent | First step gets them in; CPF + LGPD consent on step 2. Adds a "half-registered" state. | |
| Three-step wizard | Progressive disclosure (email → password → CPF+consent). Highest abandonment risk for a paid product. | |

**User's choice:** Single-page form.
**Notes:** Combined with Q4 decision, the "single page" actually captures email + password + consent — CPF moves out of sign-up.

### Q2 — When is email verification required?

| Option | Description | Selected |
|--------|-------------|----------|
| Deferred — nag banner, allow use | Login works immediately; verification required before Pluggy connect (Phase 2) and billing (Phase 5). Lower signup drop-off. | ✓ |
| Required at signup — block login until verified | Traditional double opt-in; highest data hygiene; adds a "check email" moment before any value. | |
| None in Phase 1 — decide later | No verification ships in Phase 1. | |

**User's choice:** Deferred — nag banner.

### Q3 — What does the first screen after sign-up show?

| Option | Description | Selected |
|--------|-------------|----------|
| Demo dashboard with sample data | Fake monthly dashboard with illustrative numbers + "this is what yours will look like — connect your bank to see real numbers." Mitigates P30. | ✓ |
| Empty dashboard + connect-bank CTA | Zero-state with a primary Connect button. Honest but no visible value pre-Pluggy. | |
| Welcome / onboarding carousel | 2–3 slide intro. Useful for non-obvious products; may feel patronizing. | |

**User's choice:** Demo dashboard with sample data.

### Q4 — Does signup collect CPF, or is it deferred to first bank-connect?

| Option | Description | Selected |
|--------|-------------|----------|
| CPF at signup | AUTH-01 reads as if CPF is part of account creation; validating + encrypting on day 1 is explicit and auditable. | |
| Email+password at signup, CPF required before Pluggy connect | Reduces friction on the acquisition step; CPF collected on the existing consent screen for the first bank connection. | ✓ |

**User's choice:** Email+password at signup; CPF deferred to first bank-connect.
**Notes:** Conflicts with AUTH-01 and Phase-1 Success Criterion #1 as currently worded. Planner must refine both requirements. Schema: `users.cpf_hash` and `users.cpf_enc` nullable in Phase 1, NOT NULL via Phase 2 migration.

---

## Rate-limit & Lockout Infra

### Q1 — Where should rate-limit counters and lockout state be stored?

| Option | Description | Selected |
|--------|-------------|----------|
| Postgres (same DB) | Counter table with TTL sweep via pg-boss cron. Zero new infra, trivial sa-east-1 residency. | ✓ |
| Upstash Redis sa-east-1 | Sub-ms reads, purpose-built for rate limits. Adds a paid service. | |
| In-process LRU + Postgres fallback | Per-container memory + Postgres for cross-container consistency. More code; premature optimization. | |

**User's choice:** Postgres.

### Q2 — What's the login failure policy?

| Option | Description | Selected |
|--------|-------------|----------|
| 5 failures / 15 min → 15-min lockout + unlock email | Matches AUTH-05 literally; single-use unlock link recovers immediately. | ✓ |
| Progressive backoff (no hard lockout) | Doubles next allowed interval on each failure; AUTH-05 leans toward hard lockout. | |
| 5 failures → 30-min lockout, stricter | Longer lockout; higher support burden for real users. | |

**User's choice:** 5 failures / 15-min lockout + unlock email.

### Q3 — When does CAPTCHA appear during login?

| Option | Description | Selected |
|--------|-------------|----------|
| After 2nd failure (P29) | Invisible/managed challenge (Turnstile or hCaptcha). Catches bots without annoying first typos. | ✓ |
| After 1st failure | Maximum bot defense; friction for every legit typo. | |
| Never (rely on rate-limit + lockout) | Simpler; leaves login endpoint more exposed to distributed credential stuffing. | |

**User's choice:** After 2nd failure.
**Notes:** Cloudflare Turnstile chosen as vendor (invisible, free tier, LGPD-compatible plane).

### Q4 — Password-reset request rate limiting?

| Option | Description | Selected |
|--------|-------------|----------|
| 3 resets / hour / email (matches AUTH-05) | Same store as login counters; silent-ignore in-window duplicates to prevent enumeration. | |
| 3 / hour / email + IP, stricter per-IP cap | Also caps per-IP resets (~10/hour). Stronger defense. | ✓ |
| Same as login rate limit, no separate policy | One counter for both; collapses two threat models. | |

**User's choice:** 3 / hour / email + per-IP cap.

---

## Email / Transactional Provider

### Q1 — Which transactional email provider?

| Option | Description | Selected |
|--------|-------------|----------|
| AWS SES sa-east-1 | Brazilian region, strongest LGPD story, cheapest at scale. Requires prod-access request + warming. | ✓ |
| Resend (US/EU) | Best Next.js DX; requires LGPD Art. 33 cross-border justification. | |
| Postmark (EU region) | Excellent deliverability, EU adequacy; more expensive. | |
| Defer — SES for dev now, revisit before launch | Ship with SES sandbox; track a follow-up decision. | |

**User's choice:** AWS SES sa-east-1.

### Q2 — How should email templates be authored?

| Option | Description | Selected |
|--------|-------------|----------|
| React Email components in-repo | TSX templates rendered via `@react-email/render`. Type-safe, unit-testable. | ✓ |
| Provider-hosted templates | Dashboard-managed; drifts from repo; no type checks. | |
| MJML / Handlebars files in-repo | Mature for complex marketing layouts; overkill for transactional. | |

**User's choice:** React Email components in-repo.

### Q3 — Sender domain?

| Option | Description | Selected |
|--------|-------------|----------|
| `no-reply@mail.portalfinance.app` (subdomain) | Dedicated subdomain isolates sending reputation. Industry standard. | |
| `no-reply@portalfinance.app` (apex) | Main domain; simpler DNS; couples reputation. | ✓ |
| Decide during plan — domain not yet secured | Defer until domain registration state is confirmed. | |

**User's choice:** Apex domain.

### Q4 — When to request SES production access?

| Option | Description | Selected |
|--------|-------------|----------|
| In Phase 1 plan 01-04 | Request during observability plan so real emails flow during dev/staging. 24–48h AWS review. | ✓ |
| Stay in sandbox through Phase 1; prod access before Phase 5 | Cleaner dev posture; forces allow-listing every tester; adds Phase 5 blocking dependency. | |
| Defer decision to the plan phase | Planner decides based on timeline. | |

**User's choice:** In Phase 1 plan 01-04.

### Q5 — DMARC policy on day 1?

| Option | Description | Selected |
|--------|-------------|----------|
| p=none + rua reporting | Monitoring only; upgrade in Phase 6 once reports are clean. | ✓ |
| p=quarantine directly | Aggressive; risks losing real mail if SPF/DKIM has a subtle bug. | |
| No DMARC in Phase 1 | SPF + DKIM only; weaker posture, no spoofing visibility. | |

**User's choice:** p=none + rua reporting.

### Q6 — SES SDK v3 or SMTP?

| Option | Description | Selected |
|--------|-------------|----------|
| AWS SDK v3 SES client | Native TypeScript, IAM credentials, easy retry handling. | ✓ |
| SMTP via Nodemailer | Provider-agnostic interface; easier to swap vendors; more boilerplate. | |

**User's choice:** AWS SDK v3 SES client.

### Q7 — Bounce / complaint feedback handling?

| Option | Description | Selected |
|--------|-------------|----------|
| SNS → webhook → `webhook_events` + pg-boss worker | Reuses idempotent webhook pattern from Pluggy/ASAAS. | ✓ |
| Poll SES suppression list on schedule | pg-boss cron calls ListSuppressedDestinations; delayed detection. | |
| Defer to Phase 6 hardening | Phase 1 just sends; bounce suppression later. | |

**User's choice:** SNS → webhook → `webhook_events` + pg-boss worker.

---

## Consent & DSR Skeleton Depth

### Q1 — How much of the consent flow ships in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Signup-time ToS + Privacy consent + component library | Real `user_consents` row at signup with scope, IP, UA. Reusable ConsentScreen for Phase 2. | ✓ |
| Reusable component + unit test only | Matches Success Criterion #5 literally; no signup-time consent row. | |
| Full signup consent + per-category granular toggles | GDPR-style granularity (account processing, analytics, marketing); overkill for v1. | |

**User's choice:** Signup-time ToS + Privacy consent + component library.

### Q2 — DSR skeleton scope in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| `dsr_requests` schema + route stubs that enqueue a job | User can request export/delete; creates row, enqueues pg-boss job, sends ack email. Full execution in Phase 6. | ✓ |
| Schema only — no user-facing UI | Table + `piiScrubber` scaffolding; UI + routes in Phase 6. | |
| Full working export in Phase 1 (just no Pluggy/email data) | End-to-end JSON export of users/sessions/consents; signed download link; largest Phase 1 scope. | |

**User's choice:** Schema + route stubs + ack email (PENDING).

### Q3 — How should `piiScrubber` be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Single utility with pluggable rules | `scrub(obj)` with registered `Rule<T>` patterns. Used by Sentry `beforeSend`, log wrapper, LLM prompt builder (Phase 3). | ✓ |
| Two separate utilities: one for logs, one for LLM prompts | Different aggressiveness; risk of rule-set drift. | |
| Inline ad-hoc scrubbing at each call site | Rejected — contradicts P13/P14. | |

**User's choice:** Single utility with pluggable rules.

### Q4 — `audit_log` coverage in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Auth events only | signup, login success/failure, logout, reset requested/completed, lock/unlock, consent granted/revoked. | ✓ |
| Auth + all data mutations (broad) | Every INSERT/UPDATE on user-owned rows; premature for Phase 1. | |
| Schema + minimal wiring — populated in Phase 6 | Table and helper; only signup/consent/login wired now. | |

**User's choice:** Auth events only.

---

## Claude's Discretion

Items not explicitly asked but captured in CONTEXT.md `<decisions>` as Claude-chosen defaults, with rationale. Planner may revisit during `/gsd-plan-phase`:

- Database-backed sessions via `@auth/drizzle-adapter` (dictated by AUTH-03).
- Single-master-key encryption in Phase 1; envelope/KMS deferred to Phase 6.
- Sentry SDK + `beforeSend` scrubber wired at the start of plan 01-01 (not 01-04) so boot-time errors during infra work are captured.
- `lib/env.ts` Zod-validated env loader enforces OPS-04 sandbox/prod assertion at boot.
- `subscription_tier` defaults to `'paid'` on INSERT in Phase 1.
- Password-strength policy: min 10 chars, at least one number + one letter, top-1000 blocklist.

## Deferred Ideas

See `01-CONTEXT.md` `<deferred>` section: social authentication, multi-key envelope encryption, DMARC tightening, broader audit coverage, key-rotation tooling, password-strength meter UI, granular consent toggles.

---

*Log written: 2026-04-22*
