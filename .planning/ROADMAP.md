# Roadmap: Portal Finance

## Overview

Portal Finance v1 ships a Brazilian personal-finance PWA for the middle-class wedge: connect bank and credit card via Pluggy, categorize transactions well (rules + LLM), and show a monthly dashboard that feels correct from the first sync. Six phases move from identity and LGPD posture, through the Pluggy ingestion pipeline, into categorization and the dashboard, then billing + free tier, closing with compliance hardening and operational readiness — all hosted in `sa-east-1` to satisfy LGPD data residency. The phase order is designed so each major risk (trust, LGPD, categorization, billing compliance) is mitigated before later work depends on it.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Foundation & Identity** - Railway sa-east-1 project, Next.js + Drizzle + pg-boss skeleton, Auth.js v5 with email+CPF+password, LGPD baseline (consent records, PII scrubbing, DSR skeleton), Sentry EU + structured logs
- [ ] **Phase 2: Pluggy Ingestion** - Consent-gated Pluggy Connect, webhook pipeline, transaction sync with dedup, re-auth flow, transfer & fatura detection, per-user cooldown
- [ ] **Phase 3: Categorization & Learning** - pt-BR taxonomy, merchant normalization, rules engine, Gemini Flash LLM fallback with PII scrubbing and budget, correction-as-learning loop, recategorize batch
- [ ] **Phase 4: Dashboard & Monthly Insight** - Pre-aggregated read model, aggregation worker, monthly dashboard with delta vs previous month, transaction list with filters, PWA install
- [ ] **Phase 5: Billing, Free Tier & Launch** - ASAAS integration (card + PIX + boleto + NFS-e), dunning flow, tier enforcement, downgrade-as-freeze, subscription self-service
- [ ] **Phase 6: LGPD Hardening & Operational Readiness** - Full deletion workflow, retention worker, admin audit + elevated session, webhook reconciliation, dashboards and alerts ready for real users

## Phase Details

### Phase 1: Foundation & Identity

**Goal**: Establish the Railway `sa-east-1` deployment topology (web + worker + Postgres), the Drizzle-managed schema baseline, authentication with email + CPF + password, and the LGPD and observability posture that every subsequent phase will depend on. No bank data flows yet.

**Depends on**: Nothing (first phase)

**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, LGPD-01, LGPD-05, LGPD-06, SEC-01, SEC-02, OPS-01, OPS-04

**Success Criteria** (what must be TRUE):
1. User can register with email + CPF + password, log in, and stay logged in across refresh; CPF is check-digit validated and stored encrypted.
2. Login and password-reset endpoints return 429 after the configured rate-limit threshold; account lock + unlock email works end-to-end.
3. The `users`, `sessions`, `user_consents`, `audit_log`, `admin_access_log`, `webhook_events`, and skeleton `subscriptions` tables exist in PostgreSQL `sa-east-1`; every user row has subscription_tier initialized (default "paid" until Phase 5).
4. Sentry EU captures a test exception with CPF and email in the payload — and the `beforeSend` scrubber strips both before the event is shipped; structured JSON logs contain no PII.
5. A consent screen exists as a reusable component and records the expected `user_consents` row shape (exercised by a LGPD consent unit test), even if no Pluggy connection is wired yet.
6. A runtime assertion fails fast when production env is started with sandbox credentials.

**Plans**: 5 plans

Plans:
- [x] 01-00-PLAN.md — Wave 0: Next.js 16 + TS 5.7 + Tailwind 4 + shadcn/ui scaffold, Vitest + Playwright + testcontainers, package.json scripts, pt-BR locale (completed 2026-04-22)
- [x] 01-01-PLAN.md — Railway sa-east-1 project + Drizzle schema baseline (14 tables, accounts_oauth rename, nullable CPF, subscription_tier default paid) + drizzle-kit generate/migrate + [BLOCKING] schema push (completed 2026-04-22 — Task 3 Railway provisioning deferred to Phase 6)
- [x] 01-02-PLAN.md — Auth.js v5 credentials provider (next-auth@beta + @auth/drizzle-adapter), argon2id + AES-256-GCM + HMAC-SHA-256 CPF helpers, @brazilian-utils/brazilian-utils CPF validator, Postgres rate limit (5/15 + 3/hour + 10/hour-per-IP), Cloudflare Turnstile after 2nd failure, IDOR baseline, UI-SPEC § 2.1–2.7 forms (completed 2026-04-22)
- [x] 01-03-PLAN.md — LGPD scaffolding: piiScrubber with pluggable rules + full corpus, ConsentScreen reusable component (scope discriminated-union), pg-boss singleton + worker entrypoint, React Email templates + SES mailer with suppression guard, DSR /api/privacy/{export,delete} stubs (PENDING only; execution Phase 6), Settings > Privacy UI, ToS/Privacy skeleton markdown + consent_version hash (completed 2026-04-22)
- [x] 01-04-PLAN.md — Observability close-out: Sentry EU (de.sentry.io) with synchronous piiScrubber beforeSend, pino structured logger (Node + edge), instrumentation.ts with OPS-04 env assertion, SES production access request + SNS bounce webhook (idempotent webhook_events — Phase 2 pattern validator), DemoDashboard + EmailVerificationNagBanner per UI-SPEC § 2.9/2.10, docs/ops runbooks + README (completed 2026-04-22 — Task 4 SES/Sentry console setup deferred to ops)

### Phase 01.1: Infra Bootstrap (AWS sa-east-1 via Copilot) (INSERTED)

**Goal:** Replace the Railway-based deploy plan with AWS `sa-east-1` via Copilot CLI: provision a Copilot app with `web` (Load Balanced Web Service) + `worker` (Backend Service) + `migrate` (Scheduled Job), an RDS Postgres 16 environment addon (private, encrypted, deletion-protected), SSM SecureString secrets, an ACM-fronted ALB behind Cloudflare (Full Strict), and replace `docs/ops/railway-setup.md` with an AWS-native runbook. Flip production start to `node .next/standalone/server.js` (Dockerfile CMD) and pre-compile the worker with tsup. No application-code behavior changes beyond the build / entrypoint seam.

**Requirements**: OPS-01, OPS-04, LGPD-05, SEC-02

**Depends on:** Phase 1

**Plans:** 9/9 plans complete

Plans:
- [x] 01.1-00-PLAN.md — Wave 0 (manual/blocking): Install AWS Copilot CLI + IAM Identity Center SSO setup for profile `portalfinance-prod`; scaffold docs/ops/aws-copilot-setup.md with section 0 (D-17)
- [x] 01.1-01-PLAN.md — Wave 1: Bump engines.node to 22.x; rewrite start:web to `node .next/standalone/server.js`; add /api/health route + unit test; annotate next.config.ts (D-10, D-12, D-24)
- [x] 01.1-02-PLAN.md — Wave 1: tsup.config.ts bundling worker + migrate to dist/; widen env.ts to accept SERVICE_NAME=migrate without TURNSTILE/AWS creds (D-11)
- [x] 01.1-03-PLAN.md — Wave 1: Multi-stage Dockerfile + .dockerignore + scripts/entrypoint.sh composing DATABASE_URL from RDS + Secrets Manager; SES IAM task-role pivot (D-06, D-09, D-12, RESEARCH Rec 1)
- [x] 01.1-04-PLAN.md — Wave 2: Copilot manifests (env, web, worker, migrate) + environment-level RDS addon CFN (private, db.t4g.micro, deletion-protected) + scripts/validate-phase-01.1.sh skeleton (D-01..D-05, D-07, D-08, D-18, D-19, D-22, D-23, D-24)
- [x] 01.1-05-PLAN.md — Wave 3 (remote): copilot app/env init + env deploy (VPC + ALB + RDS) + copilot secret init for 5 SSM SecureStrings + copilot svc deploy web/worker (D-02, D-05, D-13, D-17)
- [x] 01.1-06-PLAN.md — Wave 3 (remote): copilot job run --name migrate (Drizzle migrations against prod RDS) + schema parity check via copilot svc exec + psql + idempotency re-run (D-07)
- [x] 01.1-07-PLAN.md — Wave 3 (remote): ACM cert issue + Cloudflare DNS orange-cloud CNAME + SSL mode = Full Strict + end-to-end /api/health through Cloudflare + append remote gates to validate-phase-01.1.sh (D-13, D-14, D-15, D-16)
- [x] 01.1-08-PLAN.md — Wave 4 (docs): Populate docs/ops/aws-copilot-setup.md sections 1-7; scrub Railway refs from encryption-key-rotation.md + ses-production-access.md; delete railway-setup.md; update STATE.md deferred items (Closed by 01.1)

### Phase 2: Pluggy Ingestion

**Goal**: Ship the full Pluggy integration end-to-end with all safety nets in place before any categorization is attempted. User can consent, connect a bank, see transactions in their raw form, reconnect when the item breaks, and trust that the system never duplicates or double-counts.

**Depends on**: Phase 1

**Requirements**: LGPD-02, CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, CONN-06, CONN-07, TX-01, TX-02, TX-03, TX-04, TX-05, TX-06

**Success Criteria** (what must be TRUE):
1. User opens the consent screen for a specific institution, clicks through to Pluggy Connect, connects a sandbox bank, and within 60 seconds sees accounts and transactions in the UI.
2. Replaying the same Pluggy webhook event three times produces identical DB state (idempotency test passes); posting an invalid auth header returns 401.
3. An item forced into `LOGIN_ERROR` (via Pluggy sandbox) shows a per-item reconnect banner; clicking "Reconnect" opens Pluggy Connect for that item; no sync is triggered on the broken item.
4. A cross-account transfer (debit on checking, credit on savings) is flagged `is_transfer = true` on both rows; monthly totals exclude it.
5. A credit-card fatura payment (checking debit near the card due date) is flagged `is_credit_card_payment = true` and excluded from expense aggregates; the individual card-line-item transactions remain as the expenses.
6. `pluggy_item_id` is never visible in plaintext in the DB, logs, or any API response; a dev-mode `SELECT` confirms the column stores ciphertext.
7. Requesting manual sync inside the cooldown window returns a clear "please wait N minutes" response; free-tier users cannot trigger manual sync at all.

**Plans**: TBD (estimated 4–6 plans)

Plans:
- [ ] 02-01: Pluggy client + connect-token endpoint + consent screen gating the widget
- [ ] 02-02: Webhook receiver with auth header + idempotent `webhook_events` + pg-boss enqueue
- [ ] 02-03: `pluggy-sync-worker` for initial and incremental syncs, encrypted `pluggy_item_id`, per-user singleton key
- [ ] 02-04: `TransferDetector` worker + credit-card fatura detection
- [ ] 02-05: Re-auth flow (item/error → banner + email; reconnect deep link)
- [ ] 02-06: Raw transaction list UI + item health badges + manual-sync cooldown

### Phase 3: Categorization & Learning

**Goal**: Land the categorization differentiator. Transactions that land in Phase 2 must categorize correctly via rules first, then the LLM only when necessary, with per-user learning from corrections. No dashboard yet — this phase is about getting the data tagged.

**Depends on**: Phase 2

**Requirements**: CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, CAT-06, CAT-07, LGPD-06 (LLM prompt PII scrubbing)

**Success Criteria** (what must be TRUE):
1. A fresh Pluggy sandbox sync produces transactions where ≥ 70 % are categorized by rules (shared + per-user) without the LLM being called; the remaining uncategorized transactions are handled by the LLM up to the per-user daily budget, then UNCATEGORIZED.
2. Variants of the same merchant (e.g., "IFOOD *PEDIDO", "APLIC IFOOD", "PIX IFOOD PAGAMENTOS") map to the same canonical merchant and share rules.
3. When a user corrects a transaction's category, the next sync containing a transaction from the same merchant categorizes correctly without an LLM call; a "we learned this" confirmation is shown.
4. LLM prompts contain no CPF and no PIX recipient names (verified by an inspection test); the LLM response is validated against the closed category enum and any out-of-taxonomy value falls to UNCATEGORIZED with a log entry.
5. A user who hits their daily LLM budget sees remaining transactions fall to UNCATEGORIZED rather than silently running over budget; `llm_usage` reflects the cap.
6. `recategorize_batch` can re-run the current engine over historical transactions for a single user or all users without duplicating work.

**Plans**: TBD (estimated 4 plans)

Plans:
- [ ] 03-01: pt-BR taxonomy + `categories` seeds + `merchant_aliases` seeds (high-frequency merchants)
- [ ] 03-02: `MerchantNormalizer` + `RulesEngine` + `category_rules` CRUD
- [ ] 03-03: LLM fallback with Vercel AI SDK + Gemini Flash 2.0, PII scrubbing, closed-enum validation, per-user budget
- [ ] 03-04: Correction-as-learning flow + `recategorize_batch` worker

### Phase 4: Dashboard & Monthly Insight

**Goal**: Ship the paid product's visible value — the monthly dashboard. Depends on categorization being solid (Phase 3) and the aggregation worker being in place so the dashboard reads pre-aggregated data. Also ships PWA installability.

**Depends on**: Phase 3

**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, APP-01, APP-02

**Success Criteria** (what must be TRUE):
1. Dashboard for the current month shows total income, total expenses, net result, and a breakdown by top-level category within 300 ms (server-rendered) after the initial sync completes.
2. Every headline metric shows delta vs previous month with color coding (green/amber/red); the transaction list supports filters by month, account, category, and free-text description.
3. An inspection of the dashboard SQL confirms no GROUP BY / SUM runs across `transactions` at request time — the page reads from `monthly_summaries` and `category_monthly_totals`.
4. After a user correction, the aggregation worker (debounced per user) updates the affected month's read-model rows within 30 seconds and the dashboard reflects the correction.
5. The PWA installs on iOS Safari and Android Chrome, shows the correct icon, and the dashboard route works offline with a graceful "offline — last synced X" notice.

**Plans**: TBD (estimated 3 plans)

Plans:
- [ ] 04-01: `monthly_summaries` + `category_monthly_totals` schema + `aggregation-worker` (debounced per user)
- [ ] 04-02: Dashboard page (Recharts) + monthly navigation + delta computation + top categories
- [ ] 04-03: Transaction list filters + search + PWA manifest + Serwist service worker + offline shell

### Phase 5: Billing, Free Tier & Launch

**Goal**: Enable revenue and enforce the free tier, with Brazilian billing compliance (NFS-e, PIX/boleto) that is non-optional. No public launch before this phase is complete.

**Depends on**: Phase 4

**Requirements**: BILL-01, BILL-02, BILL-03, BILL-04, BILL-05

**Success Criteria** (what must be TRUE):
1. A user completes a successful paid subscription via ASAAS using a credit card; an NFS-e is issued automatically and the number + PDF URL are stored in `billing_events`. The same flow works with PIX Cobrança and boleto.
2. Simulating an `invoice.payment_failed` webhook triggers an in-app banner and an email within 1 hour; the user is not downgraded before the grace period expires.
3. A free-tier user can connect only 1 account, sees only the last 3 months of history, and cannot trigger manual sync. Attempting to connect a second account returns a paywall prompt.
4. A paid user who cancels sees their excess accounts become FROZEN (hidden, read-only) rather than deleted; resubscribing instantly restores them.
5. The subscription management page lets the user see next billing date, change plan (monthly ↔ annual), cancel at period end, and view a receipt history with NFS-e links.

**Plans**: TBD (estimated 3 plans)

Plans:
- [ ] 05-01: ASAAS client + checkout (card + PIX + boleto) + subscription creation + NFS-e wiring
- [ ] 05-02: Webhook receiver + dunning flow (banner + email + grace period) + `billing_events`
- [ ] 05-03: Tier enforcement middleware + subscription self-service UI + downgrade-as-freeze logic

### Phase 6: LGPD Hardening & Operational Readiness

**Goal**: Close all compliance gaps and wire operational reliability so the product can be handed to real users. Some items here extend scaffolding from Phase 1 (deletion, DSR) with the full downstream integrations (Pluggy, email) that did not exist yet in Phase 1.

**Depends on**: Phase 5

**Requirements**: LGPD-03, LGPD-04, SEC-03, OPS-02, OPS-03

**Success Criteria** (what must be TRUE):
1. A user requests data export and receives a JSON archive containing all their personal, account, transaction, category-correction, and subscription data within 15 days (typically within the hour in normal conditions).
2. A user requests account deletion and the full workflow runs: Pluggy `DELETE /items/:id` for every connection, removal from email lists, log anonymization, soft-delete, and hard-delete scheduled after 30 days with an audit trail in `deletion_audit_log`.
3. An admin accessing a user's data must re-authenticate; the access is logged in `admin_access_log`; admin views show aggregate summaries, never raw transaction descriptions.
4. A simulated 2-hour worker downtime is followed by the reconciliation job automatically triggering sync for every item whose `last_synced_at` is > 12 h old; no user-visible data is stale afterwards.
5. Operational dashboards exist for: sync success rate, sync p50/p95, categorization match rate (rules / LLM / uncategorized), LLM cost per day, webhook processing lag — each with an alert rule firing on threshold breach.

**Plans**: TBD (estimated 3 plans)

Plans:
- [ ] 06-01: Full deletion workflow (Pluggy DELETE + log anonymization + email list removal + 30-day legal hold) + scheduled `retention-worker` + `dsr_requests` table
- [ ] 06-02: Admin re-authentication + `admin_access_log` + admin read views (summaries only)
- [ ] 06-03: Webhook reconciliation job + operational dashboards + alerting

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 01.1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Identity | 5/5 | Complete | 2026-04-22 |
| 01.1. Infra Bootstrap (AWS Copilot) | 9/9 | Complete    | 2026-04-27 |
| 2. Pluggy Ingestion | 0/TBD | Not started | - |
| 3. Categorization & Learning | 0/TBD | Not started | - |
| 4. Dashboard & Monthly Insight | 0/TBD | Not started | - |
| 5. Billing, Free Tier & Launch | 0/TBD | Not started | - |
| 6. LGPD Hardening & Operational Readiness | 0/TBD | Not started | - |
