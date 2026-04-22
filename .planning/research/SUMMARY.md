# Project Research Summary

**Project:** Portal Finance
**Domain:** Brazilian personal finance management (Open Finance / Pluggy, middle-class segment)
**Researched:** 2026-04-22
**Confidence:** MEDIUM-HIGH

## Executive Summary

Portal Finance is a Brazilian PWA that ingests bank and credit-card data through Pluggy's Open Finance layer, categorizes transactions intelligently, and presents a monthly dashboard to middle-class users. The product is a category-defined subscription business where the daily experience that matters most is "connect my bank → see correct categories → understand this month." Every v1 engineering decision should optimize for that loop working flawlessly.

The recommended stack is a single Next.js 16 codebase (web + API routes + Server Components) backed by Drizzle ORM on PostgreSQL, a separate pg-boss worker service for async Pluggy sync and categorization, Auth.js v5 for email+CPF+password auth, ASAAS for billing (native NFS-e and recurring PIX/boleto/card), and Gemini Flash 2.0 for the LLM categorization fallback — all hosted on Railway in `sa-east-1` to satisfy the hard LGPD data-residency constraint. Vercel, Supabase, Neon, Stripe, Inngest Cloud, Clerk, and Datadog are all disqualified by that constraint; the alternatives above are the accepted replacements.

The three most dangerous risks are (1) getting Pluggy integration wrong — losing or duplicating transactions, not handling item error states, mishandling transfers and credit-card faturas, which instantly destroys trust; (2) LGPD compliance gaps — missing per-source consent, incomplete deletion flows, and especially leaking PII to a US LLM without a DPA; and (3) subscription compliance in Brazil — failing to emit NFS-e or not supporting boleto/PIX recurrence, which makes the product tax-illegal and excludes a large share of the target segment. The roadmap below is ordered to address each of these before they accumulate.

## Key Findings

### Recommended Stack

A lean, BR-resident Next.js + PostgreSQL monolith with a separate queue worker service. Full details in [STACK.md](./STACK.md). The LGPD data-residency constraint is the single strongest shaping force — it eliminates most default JS-ecosystem choices in favor of Railway sa-east-1 + self-hosted/sovereign alternatives.

**Core technologies:**
- **Next.js 16 + TypeScript + Tailwind + Drizzle ORM** — web app, API routes, Server Components, schema migrations
- **PostgreSQL 16 on Railway (sa-east-1)** — OLTP, read-model, and queue host (single instance)
- **pg-boss** — job queue inside the same Postgres; separate Railway worker service runs the actual jobs
- **Auth.js v5 credentials provider** — email + CPF + password, no third-party auth service
- **Pluggy** — Open Finance aggregator (regulated + scraping fallback)
- **ASAAS** — subscription billing with native NFS-e, recurring PIX/boleto/card, sub-accounts for future marketplace split
- **Gemini Flash 2.0 via Vercel AI SDK** — LLM fallback for categorization (budgeted; DPA required)
- **Serwist** — PWA service worker (successor to unmaintained next-pwa)
- **Sentry EU region (`de.sentry.io`)** — error tracking with PII scrubbing

**Explicitly disqualified by BR residency:** Stripe, Vercel default hosting, Supabase, Neon, Inngest Cloud, Trigger.dev Cloud, Temporal Cloud, Clerk, Auth0 standard tier, Firebase Auth, Datadog, Render, Heroku, Prisma Accelerate, next-pwa.

### Expected Features

Full feature landscape in [FEATURES.md](./FEATURES.md). The middle-class wedge has a narrow set of table stakes and a clear set of Brazilian-specific differentiators.

**Must have (table stakes in v1 MVP):**
- Email + CPF + password signup with CPF check-digit validation
- Per-data-source consent screen before Pluggy Connect (LGPD)
- Connect/reconnect/disconnect bank accounts via Pluggy
- Per-item re-auth flow when a connection goes STALE/LOGIN_ERROR
- Transaction list with filters (month, account, category, free-text search)
- Automatic categorization (rules-first, LLM fallback) with manual override
- **PIX classification done right** (not all "Outros")
- **Credit-card fatura handling** (line items as expenses; fatura payment excluded from expense totals)
- **Internal transfer detection** (excluded from income/expense aggregates)
- Monthly dashboard: total income, total expenses, net result, breakdown by category, delta vs previous month
- Paid-plan checkout and subscription self-service
- Server-enforced free tier (1 account, 3 months history, manual sync disabled)
- LGPD DSR workflow: export my data, delete my account
- PWA installability on mobile browsers

**Should have (differentiators in v1 MVP):**
- Noticeably better categorization accuracy than Mobills/Organizze baseline (rules + LLM + learning loop)
- Downgrade preserves data in read-only mode (never hard-delete on cancel)
- Merchant-name normalization so "IFOOD *PEDIDO" and "APLIC IFOOD" share the same rule

**Defer (v1.x — post-launch, data-dependent):**
- Budgets (requires validated categorization accuracy first)
- Recurring-bill detection and anomaly alerts (need ~2-3 months of data)
- 13º salário and parcelamento detection (pattern-based, needs data)
- Advanced charts and trend views

**Defer (V2+ — different product era):**
- Metas / objetivos personalizados
- Patrimônio view (investments, real estate, liabilities)
- Marketplace of financial products (investments, credit, insurance, pension)
- AI assistant / chat over real data
- In-app advertising for free users
- Native mobile apps

**Explicitly anti-feature:**
- **Manual transaction entry** — attracts the wrong persona (bookkeeping enthusiasts) and contradicts "see without work"
- **Hard-deleting data on downgrade** — trust-destroying pattern common in cheaper BR apps

### Architecture Approach

Full architecture in [ARCHITECTURE.md](./ARCHITECTURE.md). Web + API in one Next.js codebase; a separate long-lived worker service hosts all pg-boss workers; both point at the same Postgres in `sa-east-1`. Webhooks return 200 in <200 ms after idempotent event insert; all real work happens in workers.

**Major components:**
1. **Next.js web + API service** — SSR dashboards, API routes, webhook receivers; short-lived HTTP
2. **pg-boss worker service** — long-lived Node process running `pluggy-sync`, `categorization`, `aggregation`, `re-auth-notifier`, `billing-webhook`, `retention`, `dsr` workers
3. **PostgreSQL (sa-east-1)** — single source of truth for identity, financial data, pre-aggregated read-model, job queue, and audit logs
4. **Encrypted secret layer** — AES-256-GCM for Pluggy item IDs and CPF; key in environment/KMS, never in DB
5. **External services** — Pluggy (OF data), ASAAS (billing + NFS-e), Gemini (LLM), Sentry EU (errors), SMTP (transactional email)

**Key patterns:**
- **Webhook → queue → worker** (2XX in 5 s, idempotent on `event_id`)
- **Per-user singleton queue key** in pg-boss prevents Pluggy rate-limit storms and upsert races
- **Rules-first categorization** with closed-enum LLM fallback, gated by per-user daily budget, with user-correction learning
- **Pre-aggregated read-model** (`monthly_summaries`, `category_monthly_totals`) — dashboards never run GROUP BY at request time
- **Transfer and fatura-payment exclusion** — post-ingestion workers flag `is_transfer` and `is_credit_card_payment`; aggregates filter them out

### Critical Pitfalls

Top items from [PITFALLS.md](./PITFALLS.md) that must be addressed in the first two phases:

1. **Lose/duplicate transactions from partial re-sync (P1)** — `UNIQUE(pluggy_transaction_id)` + upsert; overlap sync windows by +7 days.
2. **Ignore Pluggy item error states (P2)** — model `LOGIN_ERROR`/`WAITING_USER_INPUT`/`STALE`; surface actionable UI banner per item; never sync a broken item.
3. **Plaintext item IDs or unverified webhooks (P3/P4)** — AES-256-GCM encrypt item IDs; verify webhook auth header; idempotent on `event_id`.
4. **Missing per-source LGPD consent (P11)** + incomplete deletion (P12) — per-source `user_consents` rows before Pluggy Connect; multi-step deletion workflow that also calls Pluggy `DELETE /items/:id`, anonymizes logs, and removes from email lists.
5. **Raw transaction descriptions sent to a US LLM (P14)** — PII scrubber (CPF regex, PIX name patterns) before every LLM prompt; signed DPA with the provider.
6. **Not emitting NFS-e (P22)** — hard legal requirement in BR SaaS; pick a provider (ASAAS/Iugu) that does it natively and wire it before first production charge.
7. **IDOR on transaction endpoints (P26)** — every query includes `user_id` filter; integration tests enforce it.
8. **Treating Pluggy's `category` as truth (P6)** + transfer/fatura double-counting (P7/P8) — each one single-handedly destroys dashboard credibility.

## Implications for Roadmap

Based on research, the suggested phase structure is sequenced by technical dependency and by the order in which each risk needs to be mitigated. The team is small + pre-seed with a 4-6 month launch horizon, so phases are coarse-grained but each still fits in ~3-4 weeks.

### Phase 1 — Foundation & Identity
**Rationale:** Everything needs auth, DB, observability, and the security posture before any bank data touches the system. Also establishes the pg-boss worker deployment topology so Phase 2 is not a re-architecture.
**Delivers:** Railway project in `sa-east-1` with web + worker + Postgres; Drizzle schema for `users`, `sessions`, `user_consents`, `audit_log`, `admin_access_log`, `webhook_events`, skeleton `subscriptions` (all users hardcoded "paid" until Phase 4); Auth.js v5 with email+CPF+password, CPF validation, argon2 hashing, AES-256-GCM encrypted CPF column; rate limiting on login/reset; Sentry EU with PII scrubber; structured logging baseline; DSR workflow (export + delete) skeleton.
**Addresses:** table-stakes auth; LGPD baseline (P11, P12, P13, P15).
**Avoids:** P26 IDOR, P28 CPF storage, P29 rate limiting, P36 observability.

### Phase 2 — Pluggy Ingestion
**Rationale:** The full bank-connection → transactions-in-DB loop is the riskiest pipe in the system. Must land end-to-end with all safety nets before any categorization or dashboard work.
**Delivers:** pg-boss workers live; Pluggy connect-token endpoint; react-pluggy-connect widget inside a consent screen; webhook receiver with auth header + idempotency; `pluggy-sync-worker` for initial and incremental syncs; `re-auth-notifier`; `TransferDetector` post-processor; credit-card fatura detection; per-user sync cooldown; AES-256-GCM encryption of `pluggy_item_id`; raw transaction list UI with last-sync status.
**Uses:** Pluggy API, pg-boss, Drizzle, Next.js Server Components.
**Avoids:** P1 dedup, P2 item states, P3 webhook, P4 encryption, P5 async sync, P7 transfer dedup, P8 fatura, P9 rate limit, P10 sandbox/prod.

### Phase 3 — Categorization & Learning
**Rationale:** The differentiator hypothesis. Without solid categorization the dashboard is worthless. Landing this before the dashboard prevents shipping a visibly-wrong product.
**Delivers:** `categories` taxonomy + pt-BR seeds; `merchant_aliases` with seeded high-frequency merchants (iFood, Uber, etc.); `category_rules` (per-user + shared); `MerchantNormalizer` + `RulesEngine`; Gemini Flash 2.0 fallback with closed-enum validation and PII scrubber; per-user daily LLM budget (`llm_usage`); user-correction learning (corrections become per-user rules); `recategorize_batch` job for rule changes; "we learned this" UX feedback.
**Uses:** Vercel AI SDK, Drizzle, pg-boss.
**Avoids:** P6 Pluggy category trust, P14 cross-border PII, P17 rule tangle, P18 hallucinations, P19 runaway cost, P20 no learning, P21 merchant normalization, P34 recategorization.

### Phase 4 — Dashboard & Monthly Insight
**Rationale:** This is the paid product's visible value. It depends on categorization + transfer detection being correct. Pre-aggregation worker must exist before the first dashboard render at scale.
**Delivers:** `monthly_summaries` + `category_monthly_totals` schema; `aggregation-worker` (debounced per user); dashboard with income/expenses/net + delta vs previous month + top categories with delta coloring; per-month drill-down; incremental webhook flows (`transactions/created|updated|deleted`) fully wired; PWA manifest + Serwist.
**Uses:** Recharts, Next.js Server Components, Serwist.
**Avoids:** P31 no-delta dashboard; performance trap of live GROUP BY.

### Phase 5 — Billing, Free Tier & Launch
**Rationale:** Revenue + free-tier enforcement + compliance (NFS-e) must all land together. No point launching before users can actually pay legally.
**Delivers:** ASAAS integration (subscription creation, checkout flow with card + PIX + boleto); NFS-e automation wired through ASAAS; `subscriptions`, `billing_events`; webhook receiver for `invoice.paid`/`invoice.payment_failed`/`subscription.canceled`; in-app dunning banner + email on payment failure with grace period; tier enforcement middleware (free: 1 account, 3 months history, scheduled sync only — manual disabled); subscription management UI; downgrade-as-freeze (accounts go `FROZEN`, not deleted).
**Uses:** ASAAS REST API, pg-boss, Drizzle.
**Avoids:** P22 NFS-e, P23 boleto/PIX, P24 silent payment failure, P25 downgrade deletion, P32 paywall hides core feature.

### Phase 6 — LGPD Hardening & Operational Readiness
**Rationale:** Ship the product without ship-stopping compliance gaps or operational blind spots. Some of this is scaffolded in Phase 1 and matured here.
**Delivers:** Full DSR flows (`dsr_requests`); deletion workflow that calls Pluggy `DELETE /items/:id`, removes from email lists, anonymizes logs, and runs the 30-day legal-hold + hard-delete job; `RetentionWorker` scheduled; webhook reconciliation job (reconnect items whose last sync is > 12 h old); admin re-authentication + full `admin_access_log`; dashboards/alerts for sync success rate, categorization match rate, LLM cost, webhook lag.
**Avoids:** P12 incomplete deletion, P15 DSR, P16 retention, P27 admin audit, P35 webhook replay, P36 observability.

### Phase Ordering Rationale

- **Identity before data.** Auth, consent, encryption, and logging posture must exist before any financial data is touched. Retrofitting LGPD onto a system after v1 is an order of magnitude more expensive.
- **Ingestion before categorization.** Categorization cannot be validated without real transactions. The ingestion phase must prove the webhook/queue/worker topology and the safety nets before the engine is built on top.
- **Categorization before dashboard.** The dashboard reads categorized data. Without a working categorization engine and transfer/fatura detection, the dashboard is visibly wrong from day one.
- **Dashboard before billing.** Users need to experience the free-tier value before they'll pay. Wiring billing before the value prop exists is premature optimization of a funnel with no funnel.
- **Compliance hardening at the end.** Operational reliability, admin audit, retention, and DSR flows are scaffolded during Phase 1 but matured after the product shape is stable and all the systems that touch user data exist.

### Research Flags

Phases likely needing a deeper `/gsd-research-phase` pass before planning:

- **Phase 2 (Pluggy Ingestion):** Pluggy webhook payload shapes, item lifecycle states, and re-auth UX patterns require verification against current docs at https://docs.pluggy.ai. Confirm `avoidDuplicates` flag behavior, Pluggy Connect customization, and item/error payload fields.
- **Phase 3 (Categorization):** LLM prompt design for BR Portuguese merchant descriptions, PII-stripping regex coverage, and Maritaca Sabiá-3 feasibility spike (v2 alternative to Gemini) need dedicated research.
- **Phase 5 (Billing):** ASAAS `subscription` API, PIX Automático sandbox availability, NFS-e automation flow, and sub-account support for future marketplace all need verification against current ASAAS docs before planning.
- **Phase 6 (LGPD):** ANPD enforcement patterns and DSR response-window templates benefit from a legal review pass.

Phases with standard patterns (skip research-phase):

- **Phase 1 (Foundation):** Auth.js v5 + Drizzle + Next.js 16 is well-documented and pattern-rich.
- **Phase 4 (Dashboard):** Recharts + Server Components + Drizzle queries over pre-aggregated tables — standard pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Core choices (Next.js, Drizzle, pg-boss, Auth.js v5) verified against official docs; ASAAS / Gemini pricing approximate; verify versions at install |
| Features | MEDIUM-HIGH | Table stakes and anti-features verified across BR market; subscription UX patterns less precisely measured |
| Architecture | HIGH | Pluggy integration patterns and Next.js + pg-boss topology verified against official docs |
| Pitfalls | HIGH for LGPD statutory content; MEDIUM for Pluggy-specific API behaviors (verify against live docs) |

**Overall confidence:** MEDIUM-HIGH — enough to build a roadmap; verify specific API behaviors during phase research.

### Gaps to Address

- **ASAAS PIX Automático production readiness** — needed for Phase 5. Verify in sandbox before committing to boleto-only fallback.
- **Maritaca LLM SLA** — schedule a Phase 3 spike if Gemini DPA is delayed or rejected by legal; Maritaca is the strongest LGPD-story alternative.
- **Pluggy connector-specific quirks** — some BR banks (Caixa, Banco do Brasil) are known to behave differently on re-auth. Budget extra time in Phase 2 for Caixa/BB-specific edge cases once a real-world item is available.
- **LGPD cross-border DPA with Google** — legal must sign this before LLM categorization ships. Block Phase 3 from production until DPA is confirmed.
- **Visor Finance current pricing** — reference for free-tier limits; verify current tier structure before finalizing free-tier SKU.

## Sources

### Primary (HIGH confidence)
- Pluggy official documentation — https://docs.pluggy.ai (webhook events, item lifecycle, transaction schema)
- Next.js App Router, Drizzle ORM, Auth.js v5, pg-boss, Vercel AI SDK — verified via Context7
- LGPD Lei nº 13.709/2018 — statutory text (Art. 7, 8, 15, 16, 18, 20, 33, 48)
- BR Open Finance regulatory framework (BCB)

### Secondary (MEDIUM confidence)
- Brazilian competitor landscape: Mobills, Organizze, Olivia, Guiabolso (historic), Visor Finance, Monarch Money (intl reference)
- ASAAS / Iugu / Pagar.me NFS-e native support and recurrence models
- Gemini Flash 2.0 pricing and Maritaca Sabiá-3 availability (verify at install time)
- ANPD enforcement patterns (2022–2025)

### Tertiary (LOW confidence — needs validation)
- Exact trial-length and paywall-tier conversion benchmarks for BR middle class
- Railway `sa-east-1` region availability for Postgres (verify at project creation)
- `@serwist/next` as the canonical PWA package name (verify via `npm view`)

---
*Research completed: 2026-04-22*
*Ready for roadmap: yes*
