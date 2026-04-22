# Portal Finance — Project Guide

## Project

Portal Finance is a Brazilian personal-finance PWA built on Open Finance (Pluggy), targeting the Brazilian middle class. v1 ships: email + CPF + password auth, Pluggy-based bank connection with re-auth, rules + LLM categorization, and a monthly dashboard. Revenue engine is a paid subscription; free tier is limited (1 account, 3 months history, manual sync disabled).

- **Core value:** Seeing, without work, where your money actually goes every month.
- **Working dir:** `C:\Users\aless\git\PortalFinance\web` (the web/PWA codebase).
- **Always open first:** `.planning/PROJECT.md` (product truth), `.planning/ROADMAP.md` (phase plan), `.planning/STATE.md` (current position), `.planning/REQUIREMENTS.md` (51 v1 requirements with traceability).

## GSD Workflow

This project uses the Get-Shit-Done (GSD) workflow. All planning artifacts live under `.planning/`.

**Never** edit `.planning/*.md` directly for planning work — use the GSD slash commands:

- `/gsd-progress` — always run first to see where we are
- `/gsd-plan-phase N` — create the detailed plan for Phase N
- `/gsd-execute-phase N` — execute the plan for Phase N
- `/gsd-discuss-phase N` — gather context before planning if helpful
- `/gsd-verify-work` — validate built features through UAT
- `/gsd-ship` — create PR and prepare for merge
- `/gsd-help` — full command list

**Workflow preferences** (saved in `.planning/config.json`):

- Mode: YOLO (auto-approve steps)
- Granularity: standard (5–8 phases)
- Execution: parallel (independent plans simultaneously)
- Git tracking: yes (`.planning/` is committed)
- Research: yes (research agent before each phase plan)
- Plan check: yes (verify plan achieves goal before execution)
- Verifier: yes (verify deliverables after each phase)
- Model profile: balanced (Sonnet default)

Run `/gsd-settings` to change any of these later.

## Tech Stack (authoritative — see `.planning/research/STACK.md`)

- **Web:** Next.js 16 (App Router) + TypeScript 5.7 + Tailwind 4 + shadcn/ui
- **Data:** PostgreSQL 16 + Drizzle ORM 0.45 + drizzle-kit 0.31
- **Hosting:** Railway `sa-east-1` (web + worker + Postgres — all in Brazilian territory)
- **Jobs:** pg-boss 12 running in a separate Railway worker service, using the same Postgres
- **Auth:** Auth.js v5 (credentials provider) + `@auth/drizzle-adapter`; email + CPF + password; argon2 + AES-256-GCM
- **Open Finance:** Pluggy (regulated + scraping fallback) via `react-pluggy-connect` + REST client
- **Billing:** ASAAS (native NFS-e + PIX Cobrança + boleto + card recurring + sub-accounts for future marketplace)
- **LLM (categorization fallback):** Gemini Flash 2.0 via Vercel AI SDK (`@ai-sdk/google`); signed DPA required before production
- **Validation:** Zod v4; `@brazilian-utils/br-validations` for CPF
- **UI:** shadcn/ui + React Hook Form + TanStack Query v5 + Recharts
- **PWA:** Serwist (`@serwist/next`) — verify package name at install
- **Observability:** Sentry EU (`de.sentry.io`) with `beforeSend` PII scrubbing; structured JSON logs

**Disqualified for BR residency (do NOT use):** Vercel default hosting, Supabase, Neon, Stripe, Inngest Cloud, Trigger.dev Cloud, Temporal Cloud, Clerk, Auth0 standard tier, Firebase Auth, Datadog, Render, Heroku, Prisma Accelerate, `next-pwa`.

## Architecture (see `.planning/research/ARCHITECTURE.md`)

- Monolithic Next.js web + API routes.
- Separate long-lived worker service running pg-boss workers (Pluggy sync, categorization, aggregation, re-auth notifier, billing handler, retention, DSR).
- Webhook receivers return 200 in < 200 ms after idempotent `webhook_events` insert; all work happens in workers.
- Per-user pg-boss singleton key prevents Pluggy rate-limit storms.
- Dashboard reads pre-aggregated `monthly_summaries` and `category_monthly_totals` — NEVER run `GROUP BY` across `transactions` at request time.
- Transfers and credit-card-fatura payments are flagged and excluded from aggregates.

## Critical Pitfalls (see `.planning/research/PITFALLS.md`)

Always keep these in mind when touching related code:

- **Dedup transactions** with `UNIQUE(pluggy_transaction_id)` + upsert (P1).
- **Model every Pluggy item state** (LOGIN_ERROR / WAITING_USER_INPUT / STALE) with actionable UI (P2).
- **Verify webhook auth header + idempotency** on `event_id` (P3).
- **Encrypt `pluggy_item_id`** with AES-256-GCM (P4). Never log.
- **Sync is always async** — never in an HTTP handler (P5).
- **Never trust Pluggy's `category` field** directly (P6).
- **Detect transfers + fatura payments** post-ingestion to avoid double-counting (P7, P8).
- **LGPD per-source consent** before Pluggy Connect (P11); full deletion workflow (P12); PII scrubbed before logs and LLM prompts (P13, P14).
- **NFS-e is legally required** for every charge (P22).
- **IDOR guard** on every query (`AND user_id = $session`) (P26).
- **CPF validated + AES-encrypted** (P28).

## Conventions

This repo inherits the user's global code/content conventions from `~/.claude/CLAUDE.md`:

- **Documentation, code (comments/variable names/messages), commits:** US-English (EN_US).
- **Diagrams:** Mermaid.
- **Commit template:**

  ```
  <type>(<scope, component or module>): <subject>

  <description>

  <plan><phase><step/task>
  ```

  Commit types: `docs`, `specs`, `plan`, `reqs`, `test`, `ide`, `deploy`, `feature`, `refactor`, `review`, `format`, `fix`.

- **Naming:**
  - Classes/Structs: `PascalCase` (`ProcessInstance`)
  - Functions: `camelCase` (`getAvailableJobs()`)
  - Variables / private members: `snake_case` (`job_key`)
  - Local variables: `camelCase`
  - Constants: `UPPER_SNAKE` (`MAX_RETRIES`)
  - Source files: `PascalCase.ts` (`BPMNEngine.hpp` pattern — use `.ts`/`.tsx` for this project)
  - Folders: `snake_case`
  - Template params: `TPascalCase`
- **Acronyms always uppercase:** BPMN, DMN, FEEL, RPA, SQL, DB, API, OCR, WASM, CSV, XML, JSON, AWS, GCS, SFTP, HTTP, HTTPS.

## Current Position

See `.planning/STATE.md` for authoritative current position. At initialization: Phase 1 of 6 (Foundation & Identity) ready to plan.

---

*Last updated: 2026-04-22 after initialization.*
