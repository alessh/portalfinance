# Stack Research

**Domain:** Brazilian personal finance management (Open Finance / Pluggy, middle-class segment)
**Researched:** 2026-04-22
**Confidence:** MEDIUM-HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | ^16.2 | Web framework (App Router, SSR, API routes, Server Actions) | Fixed by project decision; best-in-class DX for data-heavy dashboards |
| TypeScript | ^5.7 | Typed JavaScript | Fixed; required for financial correctness |
| Tailwind CSS | ^4.0 | Utility-first CSS | Fixed; ships with shadcn/ui |
| PostgreSQL | 16 | Primary OLTP datastore | Fixed; also used as job queue host (pg-boss) and read-model store |
| Drizzle ORM | ^0.45 | SQL query builder + schema | Lighter than Prisma, no binary engine, explicit SQL (better for finance). Prisma Accelerate is US-only and disqualifies it under BR residency |
| drizzle-kit | ^0.31 | Migrations CLI | Standard Drizzle companion |
| pg-boss | ^12.15 | Job queue and scheduler | Runs inside the project Postgres — zero new infra, keeps all data in BR. Inngest/Trigger.dev/Temporal cloud all disqualified (no BR region) |
| Auth.js v5 (next-auth) | ^5.0 | Auth framework (credentials provider) | Self-hosted, no third-party data residency problem. Clerk/Auth0 standard tier/Firebase all disqualified for BR residency |
| `@auth/drizzle-adapter` | ^1.11 | Auth.js ↔ Drizzle adapter | Keeps user/session tables in our own Postgres |
| ASAAS REST API | v3 | Billing / subscriptions | Native NFS-e issuance (legal requirement in BR SaaS), PIX Automático (Bacen-mandated), boleto/cartão recurring, sub-accounts for future marketplace split. Stripe disqualified for residency + NFS-e |
| Pluggy REST API + Connect Widget | Latest | Open Finance aggregator (fixed by project decision) | Covers regulated OF + scraping fallback; required for BR market |
| Vercel AI SDK | ^6.0 | LLM client abstraction | Unified interface for categorization fallback + future AI assistant |
| `@ai-sdk/google` | ^3.0 | Gemini Flash 2.0 provider | ~R$0.002 per 200-token categorization call; best cost/quality at this scale. Maritaca (BR-hosted) considered as v2 upgrade once SLA proven |
| Zod v4 | ^4.0 | Runtime validation | Stable since July 2025; required for API route and form validation |
| `@brazilian-utils/br-validations` | ^6.3 | CPF validation | Battle-tested, zero dependencies |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn/ui | Latest (CLI) | UI component primitives (copy-in, not npm) | All UI surface |
| React Hook Form | ^7.73 | Form state | Every form (signup, connect account, subscription management) |
| `@hookform/resolvers` | Latest (Zod v4-compatible) | RHF ↔ Zod bridge | Verify v4 support with `npm view @hookform/resolvers version` before install |
| TanStack Query | ^5.99 | Client data fetching / cache | Dashboard, transactions list, any page with polling or refetch |
| Recharts | ^3.8 | Charts | Monthly dashboard, category breakdown, evolution graphs |
| Serwist (`@serwist/next`) | Latest | PWA service worker | v1 PWA requirement. `next-pwa` is unmaintained; Serwist is the successor. Verify package name at install time |
| Sentry (`@sentry/nextjs`) | ^10.49 | Error tracking | Point to EU region (`de.sentry.io`) to stay out of US; scrub PII before send |
| dayjs or date-fns | Latest | Date math | Any month/period bucketing; pt-BR locale |
| argon2 or bcrypt (node) | Latest | Password hashing | Credentials provider storage |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Railway CLI | Deployment to `sa-east-1` | Three services in one project: Next.js web, pg-boss worker, Postgres |
| Drizzle Studio | DB GUI | `drizzle-kit studio` — local DB inspection |
| Playwright | E2E tests | For subscription + Pluggy Connect flows (mock webhooks in staging) |
| ESLint + Prettier | Lint/format | Standard Next.js config |
| pnpm | Package manager | Faster than npm; Railway supports it natively |

## Installation

```bash
# Core framework + DB
pnpm add next@^16 react@^19 react-dom@^19 typescript@^5
pnpm add drizzle-orm@^0.45 postgres
pnpm add -D drizzle-kit@^0.31

# Auth + validation
pnpm add next-auth@^5 @auth/drizzle-adapter@^1
pnpm add zod@^4
pnpm add @brazilian-utils/br-validations@^6
pnpm add argon2

# Jobs / queue
pnpm add pg-boss@^12

# UI
pnpm add react-hook-form@^7 @hookform/resolvers
pnpm add @tanstack/react-query@^5
pnpm add recharts@^3
pnpm add tailwindcss@^4 postcss autoprefixer
# shadcn/ui installed via CLI (copy-in):
pnpm dlx shadcn@latest init

# PWA + observability
pnpm add @serwist/next
pnpm add @sentry/nextjs@^10

# LLM
pnpm add ai@^6 @ai-sdk/google@^3

# Dates
pnpm add dayjs
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Drizzle ORM | Prisma | Only if team already has deep Prisma expertise AND accepts self-hosted migrations (skip Prisma Accelerate — US-only) |
| pg-boss | BullMQ + Redis | If you need advanced scheduling features and can add Redis in sa-east-1. Adds infra; not worth it at pre-seed |
| pg-boss | Inngest / Trigger.dev cloud | **Never for Portal Finance** — no BR region violates LGPD posture |
| ASAAS | Iugu | Acceptable second choice; weaker sub-account/split API than ASAAS |
| ASAAS | Pagar.me | If you need advanced anti-fraud and volume pricing at scale (post-seed) |
| ASAAS | Stripe | **Never for v1** — no NFS-e, data residency violation |
| Gemini Flash 2.0 | Claude Haiku | Slightly better quality for categorization; ~2-3× cost |
| Gemini Flash 2.0 | Maritaca Sabiá-3 | Once SLA is proven. Fully BR-hosted — strongest LGPD story for v2 |
| Gemini Flash 2.0 | Self-hosted open model | Only if cost per call is validated as a business-stopper (unlikely at v1 scale) |
| Auth.js v5 | Lucia Auth | Viable; smaller community, more manual glue |
| Railway (sa-east-1) | AWS ECS/Fargate in sa-east-1 | Post-seed when infra complexity is justified |
| Railway (sa-east-1) | GCP Cloud Run southamerica-east1 | Equivalent; Railway picked for faster pre-seed setup |
| Sentry EU | GlitchTip self-hosted | If Sentry EU DPA is rejected by legal; adds ops burden |

## Hosting Decision: Railway vs Vercel

Vercel is the better Next.js host in isolation (best-in-class DX, edge CDN, fastest previews). Railway was chosen because two Portal Finance constraints are non-negotiable and Vercel cannot satisfy them at v1 budget: **LGPD data residency** and **long-lived `pg-boss` workers**.

### Comparison

| Dimension | Railway | Vercel |
|---|---|---|
| BR region | `sa-east-1` (São Paulo) on web + worker + Postgres | No native BR region on Hobby/Pro; serverless defaults to US/EU; dedicated BR region requires Enterprise |
| LGPD residency | All compute + DB inside BR territory | Data transits/processes outside BR unless Enterprise + custom region config |
| Long-lived workers | First-class "service" primitive — `pg-boss` runs as a persistent Node process | No long-running processes (15 min Pro / 5 min Hobby cap); `pg-boss` incompatible |
| Postgres | Managed Postgres 16 in same region as app, private networking | Vercel Postgres is Neon-backed (US/EU only — disqualified) |
| Pricing model | Usage-based (CPU/RAM/egress) — predictable for steady-state | Per-invocation + bandwidth — spikes with webhook/sync bursts |
| Cold starts | None (long-lived containers) | Yes on serverless — hurts the "<200 ms webhook 200" requirement |
| Pluggy singleton | Per-user `pg-boss` singleton key works naturally | Needs external coordination (Redis lock) because functions are stateless |
| Cron | Native Railway Cron | Vercel Cron (Pro+), still serverless-bound |
| DX for Next.js | Solid (Nixpacks / Dockerfile) | Excellent (first-party) |
| Preview envs | Per-branch | Per-PR, faster |

### Concrete disqualifiers for Vercel

1. **LGPD Art. 33** — transferring personal data abroad requires adequacy decision, SCCs, or explicit consent. Running the DB on Neon-US means every sync transfers CPF + bank data to the US; the compliance and consent-UX cost is not worth it for v1.
2. **`pg-boss` needs a live Postgres connection held by a long-running worker.** Serverless cannot host that. Porting async jobs to Inngest / Trigger.dev / Temporal is blocked — all disqualified for residency (see "What NOT to Use").
3. **Webhook and sync fan-out.** Pluggy webhooks arrive in bursts. Serverless pays per-invocation, cold-starts under load, and the per-user singleton pattern (pitfalls P5/P6) needs a warm coordinator.

### Trade-offs accepted with Railway

- Slower Next.js deploys than Vercel's edge pipeline.
- No zero-config edge/ISR CDN — Next.js served from a single BR region. Acceptable because the audience is in BR.
- Self-managed Sentry, logging, analytics (already picked: Sentry EU + structured JSON logs).
- Railway has had platform incidents historically — mitigate via status monitoring and DB backups.

### When Vercel would have won

US-only, stateless product with no background jobs. Not Portal Finance.

## Edge Decision: Cloudflare as Complement to Railway (Not Substitute)

Cloudflare cannot replace Railway for Portal Finance because it does not host the two things the product depends on: **Postgres in BR territory** and **long-lived `pg-boss` workers**. However, Cloudflare covers layers Railway does not do well (CDN, WAF, DDoS, object storage, edge rate limiting) and should be plugged **in front of** Railway.

### Comparison

| Dimension | Railway | Cloudflare (Workers / Pages / D1 / R2) |
|---|---|---|
| BR residency (LGPD) | `sa-east-1` explicit on web + worker + Postgres | Workers run in global PoPs (includes BR), but no guarantee that data *stays* in BR. Data Localization Suite with BR jurisdiction is Enterprise-only (expensive). D1 has no BR jurisdiction option |
| Execution model | Long-lived Node containers (persistent) | V8 isolates, stateless, 30s CPU (paid) / 10ms (free). Durable Objects provide state but are not full Node processes |
| `pg-boss` worker | ✅ Dedicated Node process holding a Postgres connection with `LISTEN/NOTIFY` | ❌ Impossible on Workers. Durable Objects do not run the full Node ecosystem (no `pg`, no `postgres` driver, no persistent TCP listen/notify) |
| Managed Postgres | ✅ Postgres 16 in `sa-east-1`, same private network as the app | ❌ No managed Postgres. Hyperdrive is a pooler/cache — you still need Postgres hosted elsewhere |
| D1 as primary DB | N/A | ❌ Globally-replicated SQLite, cannot be pinned to BR, not suited for transactional finance volume with monthly aggregates |
| Webhook receiver <200ms | Good (warm container in BR) | ✅ Excellent — Workers at the edge respond in ~5–20ms from the São Paulo PoP |
| Jobs / queue | `pg-boss` on the same Postgres (shared transaction outbox pattern) | Cloudflare Queues exists, but separate from your DB — loses the "enqueue in same transaction as write" guarantee |
| Cron | Railway Cron native | Workers Cron Triggers (same execution model caveats) |
| CDN / static assets | Basic (serve from Next) | ✅ Market leader — free CDN, BR PoPs, aggressive cache |
| DDoS / WAF / Bot management | None native | ✅ Market leader — L3–L7 protection free on all tiers |
| R2 (object storage) | None (need external S3/GCS) | ✅ S3-compatible, free egress — ideal for NFS-e PDFs, receipts, backups |
| Zero Trust / Access | None | ✅ Great for protecting `/admin`, Drizzle Studio, internal dashboards (free up to 50 users) |
| Pricing (steady-state) | Predictable CPU/RAM/egress | Per-invocation + KV ops + Queue messages + R2 GB. Unpredictable under Pluggy webhook bursts |
| Next.js server-side DX | ✅ Full SSR + API routes + workers in one project | `@cloudflare/next-on-pages` works but forces all code into the Workers runtime (no `fs`, restricted `net`, no native libs). `argon2` native, `@sentry/nextjs` server, Postgres drivers all require adaptation or replacement |

### Concrete disqualifiers for Cloudflare as the core platform

1. **`pg-boss` does not run in V8 isolates.** It is the backbone of sync, categorization, transfer detection, LGPD retention, and NFS-e issuance. Replacing it with Cloudflare Queues + Workers means a different queue, a different model, and losing the shared-transaction outbox that `pg-boss` gives by living in the project Postgres.
2. **No Postgres in BR.** Cloudflare does not host Postgres. The alternatives (Neon, Supabase) are outside BR — LGPD violation. Hosting Postgres on a BR VPS and connecting through Hyperdrive adds two providers to replicate what Railway delivers integrated.
3. **Next.js + Auth.js + argon2 friction.** `argon2` native, Sentry server-side, and several Node-only libs either do not run or require non-trivial swaps in the Workers runtime. Every Next.js release risks breaking `next-on-pages` compatibility.
4. **Unpredictable cost under webhook bursts.** Pluggy webhooks arrive in spikes (start of month, after bank maintenance windows). Per-invocation pricing can exceed a Railway container during these spikes.

### Recommended layering — Cloudflare on the edge, Railway at the core

| Layer | Use Cloudflare | Why |
|---|---|---|
| DNS + CDN | ✅ | BR PoPs, free TLS, Next.js static asset cache |
| WAF + DDoS + Bot management | ✅ | Free L3–L7 protection for `/api/auth/*` and `/api/webhook/pluggy` |
| `/static`, `/_next/static`, images | ✅ | Aggressive edge cache, free egress |
| R2 for NFS-e PDFs, statement exports, DB backups | ✅ | S3-compatible, free egress (vs S3 charging egress) |
| Cloudflare Access for `/admin`, Drizzle Studio, ops panels | ✅ | SSO + MFA free up to 50 users |
| Edge rate-limit on `/api/webhook/pluggy` (optional) | ✅ | Reject invalid auth-header requests at the edge before waking Railway |
| Turnstile captcha on signup | ✅ | Lower-friction than reCAPTCHA, no Google data flow |

Topology:

```
User (BR)
  → Cloudflare (DNS, CDN, WAF, R2, Access, Turnstile)
    → Railway sa-east-1
      ├── Next.js (web)
      ├── pg-boss worker (Pluggy sync, categorization, NFS-e)
      └── Postgres 16 (transactional data + pg-boss queue)
    → External APIs (Pluggy, ASAAS, Gemini, Sentry EU)
```

### When Cloudflare would replace Railway

Stateless API, DB small enough to fit in D1, zero long-running jobs, zero native Node libs. Not Portal Finance.

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Vercel (default deployment) | Edge runtime is US/global by default; no managed Postgres in BR; background workers not supported | Railway sa-east-1 |
| Supabase (hosted) | No Brazil region; LGPD residency violation | Railway Postgres sa-east-1 |
| Neon | No Brazil region | Railway Postgres sa-east-1 |
| Stripe | No NFS-e automation; US data plane | ASAAS |
| Clerk / Auth0 default tier / Firebase Auth | Auth data flows through US/EU | Self-hosted Auth.js v5 |
| Inngest / Trigger.dev cloud / Temporal cloud | No BR region | pg-boss on project Postgres |
| Datadog (SaaS) | US-only at pre-seed pricing | Sentry EU + Railway metrics initially |
| Render / Heroku | No BR region | Railway sa-east-1 |
| Prisma Accelerate | US-only SaaS | Drizzle native or direct Postgres client |
| `next-pwa` | Unmaintained since 2024 | Serwist (`@serwist/next`) |
| Prisma binary engine on Railway | Breaks container images frequently | Drizzle (no binary engine) |
| Synchronous Pluggy sync in HTTP handler | Blocks request, timeouts, cost blowup | Enqueue via pg-boss, webhook-driven |

## Stack Patterns by Variant

**If v1 launch must ship in 4 months:**
- Skip Temporal / advanced orchestration
- Use pg-boss cron for scheduled resyncs
- Keep dashboard server-rendered (no real-time)
- ASAAS hosted checkout redirect (not in-app Stripe Elements-style UX)

**If team hires a DevOps person in month 5+:**
- Migrate Railway Postgres to RDS sa-east-1 (backups, point-in-time recovery)
- Add read replica for analytics/dashboard rollups
- Consider Temporal self-hosted in sa-east-1 if workflow complexity grows

**If Maritaca SLA proves reliable after a Phase 3 spike:**
- Swap `@ai-sdk/google` for Maritaca provider in categorization
- Stronger LGPD story (fully BR-hosted LLM)

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Next.js ^16 | Auth.js v5 ^5.0.0 | App Router patterns; credentials provider |
| Drizzle ORM ^0.45 | postgres (node-postgres driver) | Prefer `postgres` over `pg` for Drizzle |
| Auth.js v5 | @auth/drizzle-adapter ^1.11 | Use credentials adapter, not default OAuth |
| Zod ^4 | @hookform/resolvers | Verify `npm view @hookform/resolvers version` before install — v4 support landed in late 2025 |
| Serwist | Next.js ^16 | Verify `@serwist/next` is the published name at install time |
| pg-boss ^12 | PostgreSQL 13+ | Creates its own schema; isolate from app schema |
| Sentry `@sentry/nextjs` ^10 | Next.js 16 | Must use `de.sentry.io` region for LGPD |

## Sources

- Context7 docs: Next.js, Drizzle, Auth.js v5, pg-boss, Zod v4, Vercel AI SDK — topic-targeted fetches
- Pluggy official docs — Connect widget, webhook events, item states
- ASAAS developer docs — subscriptions, NFS-e, PIX Automático, sub-accounts
- Bacen Open Finance regulation — consent, retention, data subject rights
- ANPD (LGPD) — data residency guidance, cross-border DPA requirements
- npm registry — version verification (treat as point-in-time; re-verify at `pnpm install`)

## Open Questions (for planning phase)

1. Verify Railway sa-east-1 is still a selectable region for Postgres and web services at project creation.
2. `@serwist/next` package name — confirm at install.
3. ASAAS PIX Automático sandbox — confirm recurring PIX is live before Phase 3 billing work.
4. `@hookform/resolvers` Zod v4 support — verify version.
5. Maritaca Sabiá-3 SLA — schedule a Phase 3 spike to benchmark vs Gemini.

---
*Stack research for: Brazilian personal finance management (Open Finance / Pluggy, middle class)*
*Researched: 2026-04-22*
