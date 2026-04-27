---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 01.1 complete -- AWS Copilot prod live
last_updated: "2026-04-27T20:30:00.000Z"
last_activity: 2026-04-27 -- Phase 01.1 execution complete (web + worker + migrate live, edge round-trip verified)
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 23
  completed_plans: 14
  percent: 61
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-22)

**Core value:** Seeing, without work, where your money actually goes every month.
**Current focus:** Phase 02 (Pluggy ingestion) — ready to plan

## Current Position

Phase: 01.1 (Infra Bootstrap, AWS sa-east-1 via Copilot) — COMPLETE
Plan: 9 of 9
Status: Phase 01.1 finished. https://portalfinance.app/api/health verified through Cloudflare → ALB → ECS Fargate → RDS Postgres in sa-east-1.
Last activity: 2026-04-27 -- Phase 01.1 execution complete (web + worker + migrate live, edge round-trip verified)

Progress: [██████████] 100% (Phase 01.1)

## Performance Metrics

**Velocity:**

- Total plans completed: 8
- Average duration: 18.4 min
- Total execution time: 0.9 hours

**By Phase:**

| Phase | Plans | Total  | Avg/Plan |
|-------|-------|--------|----------|
| 01 | 5 | - | - |

**Recent Trend:**

- Last 5 plans: 01-00 (11.4 min), 01-01 (7.8 min), 01-02 (36.1 min)
- Trend: Wave 2 auth work dominated — 3 tasks + 5 auto-fixed deviations (UnsupportedStrategy pivot, Next 16 build DB-URL, Radix Checkbox, Playwright Windows race, E2E cookie).

| Plan         | Seconds | Tasks   | Files        |
|--------------|---------|---------|--------------|
| Phase 01 P00 | 684     | 3 tasks | 35 files     |
| Phase 01 P01 | 469     | 2 tasks | 23 files     |
| Phase 01 P02 | 2166    | 3 tasks | 49 files     |
| Phase 01 P03 | 5700 | 2 tasks | 33 files |
| Phase 01-foundation-identity P04 | 180 | 3 tasks | 24 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- Initialization: Middle-class wedge, MVP = connect + categorize + dashboard, Pluggy, Next.js, Railway sa-east-1, ASAAS billing (pending research-backed confirmation), Gemini Flash 2.0 LLM fallback.
- Plan 01-00: Bumped @playwright/test 1.49.1 → 1.51.1 to satisfy Next 16.2.4 peer dep.
- Plan 01-00: shadcn CLI v4 dropped --style flag; used --preset nova then patched components.json style to "new-york" to honour UI-SPEC contract.
- Plan 01-00: Tailwind 4 @theme inline mapping is the canonical bridge between shadcn HSL CSS variables and utility surfaces — replaces legacy hsl(var(--token)) usage in component files.
- Plan 01-00: Vitest 3.0.5 ships the workspace API; projects field arrived in 3.2+. vitest.config.ts uses workspace[] for unit + integration projects.
- Plan 01-00: start:web simplified to "next start" — bash-style ${PORT:-3000} substitution is broken on Windows when Playwright spawns the script; Next honours $PORT natively.
- Plan 01-01: users.email uniqueness via uniqueIndex() in table extras only — column-level .unique() removed (Drizzle was emitting both CONSTRAINT and CREATE UNIQUE INDEX with same name, breaking migration).
- Plan 01-01: Drizzle migrate runner creates pgcrypto extension before drizzle-orm migrator (gen_random_uuid() dependency); generator does NOT auto-emit it.
- Plan 01-01: ENCRYPTION_KEY and CPF_HASH_PEPPER are distinct env vars (RESEARCH.md Open Question #3); documented in docs/ops/railway-setup.md.
- Plan 01-02: Auth.js v5 Credentials + DB sessions is unsupported — self-managed sessions row (INSERT on signup/login, DELETE on logout) while Auth.js owns cookie name + adapter shape for forward compatibility.
- Plan 01-02: Radix Checkbox renders input aria-hidden, breaking RHF register() — SignupForm uses a styled native checkbox instead.
- Plan 01-02: scripts/run-e2e.ts orchestrates testcontainers + .env.local rewrite BEFORE Playwright's webServer spawns (avoids globalSetup vs webServer race on Windows).
- Plan 01-02: Lazy Drizzle client construction — src/db/index.ts accepts a placeholder DATABASE_URL so Next 16 build-time "collect page data" succeeds without a live DB.
- Plan 01-02: src/jobs/boss.ts is a STUB — real pg-boss singleton + worker lands in plan 01-03; enqueue signatures remain stable.
- pg-boss v12 named export { PgBoss } (not default); localConcurrency option (not teamSize); test-mode in-memory fallback when NODE_ENV=test
- session.ts dual-path cookie resolution: optional req param reads Cookie header for integration tests; falls back to next/headers for App Router
- mailer credential guard reads process.env at call time (not cached env) so beforeAll() AWS creds in tests take effect
- DSR PII contract: DSRAcknowledgment template accepts only { request_type, dsr_request_id }; user email is SES Destination only, never in HTML body
- Synchronous beforeSend: RESEARCH.md Pitfall 5 — Sentry swallows async beforeSend; kept sync
- NEXT_PHASE build bypass: OPS-04 guards skip during next build, fire at server startup (instrumentation.ts)
- Single sentry.ts with edge-safe hash gate: edge drops user object entirely rather than hashing

### Roadmap Evolution

- Phase 01.1 inserted after Phase 1: Infra Bootstrap (AWS sa-east-1 via Copilot) (URGENT) — Railway has no BR region (`sa-east-1` does not exist at Railway); pivoting to AWS `sa-east-1` via Copilot CLI before Phase 2 (Pluggy) touches real user data. **COMPLETE 2026-04-27.**

### Phase 01.1 hotfixes captured (production-discovered, all addressed)

- **PrivateSubnets export shape:** Copilot env emits `${App}-${Env}-PrivateSubnets` as a single comma-separated list, not PrivateSubnet1/2; addon uses `Fn::Split`.
- **Copilot v1.34 `From: env` allowlist:** `VpcId` not on the list. Use `Fn::ImportValue: !Sub '${App}-${Env}-VpcId'`.
- **Env-addon nested-stack race:** ImportValue cannot resolve while parent env stack is CREATE_IN_PROGRESS. Pivot: deploy env first, then add the addon.
- **DB-bridge SSM tag-based IAM:** `DbEndpoint`/`DbPort`/`DbName`/`DbSecretArn` written as plain SSM Strings; must be tagged `copilot-application` + `copilot-environment` or task launch returns AccessDeniedException.
- **DB-access ManagedPolicy:** env-level `DBAccessPolicy` output is NOT auto-attached per service in v1.34. Workload-level `copilot/<svc>/addons/db-access.yml` is the working pattern.
- **RDS-generated password URL hazard:** `?` chars terminate userinfo, mangling host parsing. Fix: tighten `ExcludeCharacters` in addon + URL-encode in entrypoint.
- **postgres-js URL forwarding:** `?sslmode=...` / `?sslrootcert=...` ride into Postgres as startup GUCs and the server rejects them. Strip URL params; configure `ssl: { ca, rejectUnauthorized: true }` per client.
- **pg-connection-string v2:** silently aliases `sslmode=require` to `verify-full`. Bake the global RDS CA bundle into the runner image.
- **pg-boss v10+:** queues no longer auto-create. `getBoss()` calls `boss.createQueue` for every entry in `QUEUES` after `start()`.
- **Git Bash path mangling:** `MSYS_NO_PATHCONV=1` mandatory for AWS CLI calls that take `/copilot/...` parameter names on Windows.

### Pending Todos

Phase 02 (Pluggy ingestion) is the next plannable phase.

### Blockers/Concerns

- **LGPD cross-border DPA (Google)** — must be signed by legal before Phase 3 LLM categorization ships to production. Does not block Phase 1–2 work.
- **ASAAS PIX Automático sandbox** — confirm recurring-PIX is live in sandbox before Phase 5 billing work begins.
- ~~**Railway sa-east-1 region availability**~~ — RESOLVED via Phase 01.1: pivoted to AWS Copilot.
- ~~**Next.js standalone start command**~~ — RESOLVED in 01.1-01: `start:web` is `node .next/standalone/server.js`; Dockerfile runner uses Next standalone output.
- ~~**`@serwist/next` package name**~~ — RESOLVED 2026-04-22.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Ops      | SES production access (24-48h AWS approval) + Sentry EU project (DSN must end with de.sentry.io) — runbooks at `docs/ops/ses-production-access.md`. SES wiring uses IAM task role per workload addon (D-17 / SEC-02). | Open | 01-04 |
| Image    | Runner image is ~558 MB; Phase 6 may revisit Distroless / scratch + statically-linked node | Open | 01.1-03 |
| Worker   | Worker is `count: 1` (singleton-key dedup assumes one replica); horizontal scaling deferred to Phase 6 | Open | 01.1-04 |

## Session Continuity

Last session: 2026-04-27 -- Phase 01.1 execution complete
Stopped at: Phase 01.1 complete -- AWS Copilot prod live
Resume file: n/a

**Planned Phase:** 01.1 (Infra Bootstrap, AWS sa-east-1 via Copilot) -- 9 plans -- COMPLETE 2026-04-27.
**Next Phase:** 02 (Pluggy ingestion) -- ready to plan.
