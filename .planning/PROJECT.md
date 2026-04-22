# Portal Finance

## What This Is

Portal Finance is a Brazilian personal finance platform built on top of Open Finance that helps users understand, control, and grow their wealth. The v1 focuses on the **Brazilian middle class** (household income roughly R$3k–R$15k/month) and delivers three core pillars: automatic bank and credit card syncing via Open Finance, intelligent categorization of income and expenses, and a monthly financial dashboard. Longer-term the platform expands to goals, wealth evolution, and an AI-recommended marketplace of financial products (investments, credit, insurance, pension).

## Core Value

**Seeing, without work, where your money actually goes every month.** If the sync and the categorization do not feel effortless and correct from day one, the product has failed — every other feature depends on trustworthy, well-organized data.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward v1 launch. -->

- [ ] User can create an account and sign in with email, CPF, and password (with CPF format validation).
- [ ] User can connect at least one bank account or credit card through Pluggy (Open Finance regulated + scraping fallback) and see sync status clearly.
- [ ] User can re-sync on demand and see last-sync timestamp, with a friendly error surface when a connection breaks.
- [ ] Incoming transactions are automatically categorized with a rules-first engine, falling back to an LLM for unmatched cases.
- [ ] User can correct a category on any transaction and the system learns the correction for future transactions from the same merchant/pattern.
- [ ] User sees a monthly dashboard with total income, total expenses, net result, and breakdown by category.
- [ ] User sees a transactions list with filters by month, account, category, and free-text search.
- [ ] User can subscribe to a paid plan (motor de receita) and manage the subscription (change plan, cancel) from inside the app.
- [ ] Free tier is enforced server-side: 1 connected account, reduced history window, manual-only sync.
- [ ] All personal and financial data is stored in Brazilian territory, with LGPD-compliant data handling, consent, and deletion flows.
- [ ] Application is a responsive web app that behaves well on mobile browsers and is installable as a PWA.

### Out of Scope

<!-- v1 boundaries. Each exclusion is explicit to prevent scope drift. -->

- **Native mobile apps (iOS/Android)** — PWA covers mobile-web first; native is deferred until assinatura validates demand.
- **Goals / objetivos personalizados** — deferred to V1.1+; validate that daily clarity is valuable before adding goal-setting.
- **Patrimônio (investments, real estate, liabilities in one view)** — deferred; requires brokerage integrations that are not available in Pluggy’s base plan.
- **Marketplace of financial products (investments, credit, insurance, pension)** — deferred to V2; depends on a validated subscriber base and regulatory posture.
- **AI assistant / chat over real data** — deferred to V2; too expensive and risky to evaluate properly before the data layer is solid.
- **In-app advertising for free users** — deferred to V1.1+; only justified once there is a meaningful free-tier audience.
- **Direct Open Finance integration as a regulated Iniciadora/Receptora** — deferred indefinitely; Pluggy is the agreed aggregator for the foreseeable horizon.
- **Multi-currency, multi-country** — v1 is Brazil/BRL only.
- **Shared/family accounts, joint budgets** — single-user only in v1.
- **Apple Sign-In, Google OAuth** — v1 uses email + CPF + password; social auth can be added once sign-up friction is actually a validated problem.

## Context

- **Reference product:** Visor Finance (used as the pricing/tier reference: free plan with 1 account, limited history, manual sync; paid plans with unlimited connections, full history, AI assistant, multiple accounts).
- **Competitive landscape:** Mobills, Organizze, Olivia, Guiabolso (closed). The differentiation hypothesis for v1 is **noticeably better categorization** — less friction on the daily review task that users actually do.
- **Open Finance in Brazil:** Pluggy aggregates both regulated Open Finance connections and scraping fallbacks. This is the fastest and cheapest path at pre-seed; becoming a regulated institution ourselves is a multi-quarter effort that only makes sense much later.
- **Revenue model:** Three complementary streams — (1) recurring subscription (monthly/annual) as the main engine, (2) commission on financial-product referrals (V2 marketplace), (3) advertising shown only to free accounts. V1 only activates (1).
- **Team stage:** Small team, pre-seed. Roadmap must fit a 4–6 month build to public launch of a paid product, not a 12-month epic.
- **Monorepo context:** The current working directory is `PortalFinance/web` and is the web application (PWA). A separate mobile or additional packages may appear later, but v1 lives entirely here.

## Constraints

- **Tech stack (web):** Next.js + TypeScript + Tailwind, App Router. Server-rendered dashboards, PWA-capable. Chosen for SSR performance on data-heavy screens and pre-seed time-to-market.
- **Tech stack (backend):** Next.js API routes + PostgreSQL. Background jobs (Pluggy sync, categorization) must be queue-based (Inngest / Trigger.dev / equivalent) rather than in-request — Pluggy sync cannot block HTTP responses.
- **Open Finance provider:** Pluggy. No direct bank integrations and no other aggregator in v1.
- **Data residency:** All personal and financial data at rest and in use lives in Brazilian territory (AWS São Paulo / GCP southamerica-east1 / equivalent). This is a hard constraint — do not choose services that cannot satisfy this.
- **Compliance:** LGPD is non-negotiable. Consent must be explicit per data source, data deletion must be complete and auditable, access logs must exist.
- **Security:** Financial data is category-3 sensitive. Tokens and Pluggy item IDs are stored encrypted at rest. No logging of transaction descriptions in plain text.
- **Categorization engine:** v1 uses rules-first with LLM fallback for unmatched transactions. LLM usage must be budgeted per user and gated — no unbounded LLM calls per transaction.
- **Platform:** Web responsive / PWA only in v1. No native mobile in this cycle.
- **Auth:** Email + CPF + password in v1. No social sign-in in v1.
- **Naming and conventions:** Follow the user’s global conventions (see `~/.claude/CLAUDE.md`) — PascalCase classes, camelCase functions, snake_case variables, PascalCase source filenames, snake_case folders, acronyms uppercase, documentation/code/commits in US-English.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target Brazilian middle class as v1 wedge | Best balance of subscription willingness-to-pay, CAC, and market size for a pre-seed team | — Pending |
| MVP scope = connect + categorize + monthly dashboard (no goals, no marketplace, no AI) | Ships in pre-seed timebox; validates the categorization differentiator and willingness to subscribe | — Pending |
| Pluggy as the Open Finance layer | Cheapest and fastest path; covers regulated + scraping; avoids becoming a regulated institution at pre-seed | — Pending |
| Next.js + TypeScript + Tailwind, API routes + PostgreSQL | Single codebase, strong DX, SSR on dashboards, mature ecosystem for the domain | — Pending |
| Web responsive / PWA first; no native mobile in v1 | Preserves team bandwidth; PWA is good enough to validate the wedge | — Pending |
| Auth via email + CPF + password (no social auth in v1) | CPF is the de-facto Brazilian identifier and lowers ambiguity with Open Finance later | — Pending |
| Rules-first categorization with LLM fallback | Controls cost and latency; still delivers the "noticeably better categorization" hypothesis | — Pending |
| All data hosted in Brazilian territory | LGPD posture; reduces friction if we ever pursue a regulated role | — Pending |
| Billing provider not yet chosen | To be recommended by research (Stripe vs ASAAS/Iugu vs Pagar.me) based on BR recurrence, NF-e, and split-for-marketplace needs | — Pending |
| Differentiation hypothesis = better categorization | Everything else (patrimônio, marketplace, AI) depends on trustworthy transaction data; the first thing users judge is the category feed | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-22 after initialization*
