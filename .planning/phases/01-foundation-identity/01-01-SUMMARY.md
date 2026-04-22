---
phase: 01-foundation-identity
plan: 01
subsystem: data-foundation
tags: [drizzle-orm, postgresql-16, railway, data-residency, lgpd, migrations, schema, sa-east-1]
requires:
  - "Wave 0 scaffold (plan 01-00) — pnpm scripts db:generate / db:migrate / test:integration; tests/fixtures/db.ts testcontainers helper"
provides:
  - "Drizzle ORM 0.45.2 wired to Postgres via the postgres@3.4.9 driver"
  - "13 schema modules under src/db/schema/ covering all 14 Phase 1 tables (users, sessions, accounts_oauth, verification_tokens, user_consents, audit_log, admin_access_log, webhook_events, subscriptions, dsr_requests, auth_rate_limits, account_locks, password_reset_tokens, ses_suppressions)"
  - "drizzle.config.ts pointing at the schema barrel"
  - "src/db/index.ts — Drizzle client singleton (pool size adapts to NODE_ENV)"
  - "src/db/migrate.ts — production-safe migration runner; pgcrypto + drizzle-orm migrator"
  - "src/db/migrations/0000_premium_sabretooth.sql — initial migration with all tables, FKs, indexes, partial unique on cpf_hash"
  - "Idempotence + users-schema integration tests (10 tests passing against testcontainers Postgres 16)"
  - "docs/ops/railway-setup.md — runbook for the human operator: sa-east-1 verification gate, 3-service topology, env vars, drizzle-kit push ban"
  - "AuthAuditAction TS union (D-19 — 10 Phase 1 auth actions) exported from src/db/schema/auditLog.ts"
  - "bytea custom type centralized in src/db/schema/_shared.ts for AES-256-GCM encrypted columns"
affects:
  - "Phase 2 Pluggy ingestion now has a stable users.id, accounts (free name), webhook_events table waiting"
  - "Phase 1 plan 01-02 Auth.js wiring inherits database-strategy session table + accounts_oauth + verification_tokens"
  - "Phase 5 billing inherits subscriptions + subscription_tier on users"
  - "Phase 6 LGPD inherits dsr_requests + admin_access_log + user_consents append-only"
tech-stack:
  added:
    - "drizzle-orm@0.45.2"
    - "drizzle-kit@0.31.10"
    - "postgres@3.4.9"
  patterns:
    - "One file per domain aggregate under src/db/schema/; barrel re-exports from index.ts; drizzle.config.ts points at the barrel"
    - "Custom bytea type in _shared.ts — single import for every binary column"
    - "Production migrate runner: CREATE EXTENSION IF NOT EXISTS pgcrypto, then drizzle migrator (idempotent)"
    - "Audit action enum lives in TS (AuthAuditAction union) — NO DB CHECK constraint, so D-19 catalogue can grow without migration churn"
    - "Append-only consent: documented at app layer (no UPDATE/DELETE on user_consents); ON DELETE RESTRICT FK keeps history if user is soft-deleted"
    - "Partial unique index on users.cpf_hash WHERE cpf_hash IS NOT NULL — lets Phase 1 users be CPF-less; Phase 2 adds NOT NULL constraint"
key-files:
  created:
    - "drizzle.config.ts"
    - "src/db/index.ts"
    - "src/db/migrate.ts"
    - "src/db/schema/_shared.ts"
    - "src/db/schema/index.ts"
    - "src/db/schema/users.ts"
    - "src/db/schema/sessions.ts"
    - "src/db/schema/authAdapter.ts"
    - "src/db/schema/consents.ts"
    - "src/db/schema/auditLog.ts"
    - "src/db/schema/adminAccessLog.ts"
    - "src/db/schema/webhookEvents.ts"
    - "src/db/schema/subscriptions.ts"
    - "src/db/schema/dsrRequests.ts"
    - "src/db/schema/authRateLimits.ts"
    - "src/db/schema/accountLocks.ts"
    - "src/db/schema/passwordResetTokens.ts"
    - "src/db/schema/sesSuppressions.ts"
    - "src/db/migrations/0000_premium_sabretooth.sql"
    - "src/db/migrations/meta/_journal.json"
    - "src/db/migrations/meta/0000_snapshot.json"
    - "tests/integration/db/migrations.test.ts"
    - "tests/integration/db/users-schema.test.ts"
    - "docs/ops/railway-setup.md"
  modified:
    - "package.json"
    - "pnpm-lock.yaml"
decisions:
  - "users.email uniqueness declared via uniqueIndex() in table extras only — NOT also via column-level .unique(). Drizzle was emitting both a CONSTRAINT and a CREATE UNIQUE INDEX with the same name, breaking the migration."
  - "Generated migration tag is 0000_premium_sabretooth.sql (Drizzle's auto-naming) — recorded for traceability."
  - "Drizzle generator did NOT emit CREATE EXTENSION IF NOT EXISTS pgcrypto. Handled in src/db/migrate.ts before the migrator runs (idempotent NOTICE on subsequent boots) — no manual edit of the .sql file needed."
  - "Custom bytea type defined once in src/db/schema/_shared.ts and imported everywhere (users.cpf_hash, users.cpf_enc); pattern reused in Phase 2 for pluggy_item_id."
  - "audit_log.user_id FK uses ON DELETE SET NULL — keeps the audit row alive when a user is hard-deleted (LGPD allows historical audit retention; only PII fields anonymize)."
  - "user_consents.user_id FK uses ON DELETE RESTRICT — consent history MUST outlive a soft-deleted user; Phase 6 hard-delete worker anonymizes consent rows in place rather than removing them."
  - "ENCRYPTION_KEY and CPF_HASH_PEPPER are documented as DISTINCT env vars in docs/ops/railway-setup.md — resolves RESEARCH.md Open Question #3 (a single key would couple AES-GCM ciphertext to HMAC lookup digests)."
metrics:
  duration_seconds: 469
  duration_minutes: 7.8
  tasks_completed: 2
  tasks_blocked: 1
  files_created: 23
  files_modified: 2
  commits: 2
  completed: "2026-04-22T20:33:34Z"
---

# Phase 1 Plan 01: Wave 1 — Drizzle Schema Baseline Summary

Drizzle ORM 0.45.2 wired against Postgres via the `postgres@3.4.9` driver; 14 Phase 1 tables modelled across 13 schema modules; initial migration generated, idempotent, and proven against testcontainers Postgres 16. Railway sa-east-1 provisioning + the live schema push (Task 3) is a [BLOCKING] human-action gate that requires the developer to operate the Railway dashboard.

## Tasks Completed

| Task | Name                                                                                              | Status              | Commit    |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------- | --------- |
| 1    | Install Drizzle, author 13 schema files, drizzle.config.ts + db client                            | DONE                | `406bfbf` |
| 2    | Generate initial migration + write migrate runner + integration tests + Railway runbook           | DONE                | `749d494` |
| 3    | [BLOCKING] Railway provisioning + schema push to sa-east-1 Postgres                                | AWAITING HUMAN ACTION | —         |

## What Was Built

### Drizzle Wiring (Task 1)
- `drizzle.config.ts` — `dialect: 'postgresql'`, schema barrel at `src/db/schema/index.ts`, output `src/db/migrations/`, `strict: true`, `verbose: true`.
- `src/db/index.ts` — Drizzle client singleton; pool max=10 in production, max=1 elsewhere (avoids exhausting local Docker / testcontainer Postgres during integration runs); `idle_timeout: 20`, `connect_timeout: 10`.
- `src/db/schema/_shared.ts` — `bytea` custom type defined once for every binary column.
- 13 schema modules — one file per domain aggregate per RESEARCH.md § Plan slice 01-01 item 4.

### Schema Highlights
- **users:** `id uuid PK gen_random_uuid()`, `email text NOT NULL UNIQUE`, `password_hash text NOT NULL`, `cpf_hash bytea NULL` + `cpf_enc bytea NULL` (D-04 nullable in Phase 1), `subscription_tier text NOT NULL DEFAULT 'paid'` (D-19; Phase 5 flips), `email_verified_at timestamptz NULL`, `deleted_at timestamptz NULL` (soft-delete).
- **Partial unique index** on `users(cpf_hash) WHERE cpf_hash IS NOT NULL` — multiple Phase 1 users without CPF coexist; Phase 2 introduces NOT NULL.
- **accounts_oauth** (renamed from Auth.js's default `account` per Pitfall 4) — Phase 2 needs the bare `accounts` name for Pluggy. Verification token table sized to adapter requirements.
- **user_consents** — append-only by app convention (commented at file head); `ON DELETE RESTRICT` preserves consent trail.
- **audit_log** — `AuthAuditAction` TS union covers exactly D-19's 10 actions; intentionally NO DB CHECK so later phases can extend without migration churn.
- **webhook_events** — `UNIQUE(source, event_id)` is the idempotency key for the SES bounce → Pluggy → ASAAS reuse pattern.
- **auth_rate_limits** — `UNIQUE(identifier, bucket, window_start)` lets the Phase 1.02 sliding-window counter use `ON CONFLICT DO UPDATE SET count = count + 1` atomically.
- **subscriptions** placeholder + **dsr_requests** stub — Phase 5 + Phase 6 land without further migrations to existing tables.
- All FKs configured: `cascade` for soft-delete-with-user (sessions, accounts_oauth, password_reset_tokens, account_locks, subscriptions), `restrict` for audit-critical (user_consents, dsr_requests), `set null` for audit-survival (audit_log).

### Migration Runner + Tests (Task 2)
- `src/db/migrate.ts` — invoked by `pnpm db:migrate`. Runs `CREATE EXTENSION IF NOT EXISTS pgcrypto` (Landmine for 01-01) then drizzle's migrator. Idempotent.
- `src/db/migrations/0000_premium_sabretooth.sql` — generated via `pnpm db:generate`. 14 `CREATE TABLE`s, 8 FK `ALTER TABLE`s, 14 index/unique declarations.
- `src/db/migrations/meta/{_journal.json,0000_snapshot.json}` — Drizzle's bookkeeping. Committed.
- `tests/integration/db/migrations.test.ts` — 5 tests: idempotence (snapshot-equality after running twice), pgcrypto presence, all 14 tables present, NO `accounts` table, `webhook_events_source_event_unique` index present.
- `tests/integration/db/users-schema.test.ts` — 4 tests: `subscription_tier` defaults to `'paid'`, `cpf_hash`/`cpf_enc` nullable, email UNIQUE enforced, multiple NULL `cpf_hash` allowed (partial index), duplicate non-null `cpf_hash` rejected.
- `docs/ops/railway-setup.md` — single source of truth for the human operator: sa-east-1 verification, 3-service topology, env-var matrix (with `ENCRYPTION_KEY` distinct from `CPF_HASH_PEPPER`), `pnpm db:migrate` predeploy hook, drizzle-kit push ban, halt criteria, post-deploy `psql \dt` verification.

## Question Resolutions

- **Did Drizzle emit `CREATE EXTENSION IF NOT EXISTS pgcrypto` automatically?** No. The runner (`src/db/migrate.ts`) creates it before `migrate()` runs. Idempotent — produces a NOTICE on subsequent boots, no error.
- **Generated migration filename:** `0000_premium_sabretooth.sql` (Drizzle's auto-name; the original `0000_nifty_bastion.sql` was discarded with the bug fix described below).
- **Deviations from RESEARCH.md schema spec:** Zero — every column, type, nullability, FK direction, and index documented in RESEARCH.md § Plan slice 01-01 item 4 ships in the migration.
- **Env var naming gotchas:** `ENCRYPTION_KEY` and `CPF_HASH_PEPPER` are intentionally **separate** env vars (RESEARCH.md Open Question #3). Documented in the Railway runbook under § 3 Environment Variables.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Duplicate UNIQUE on `users.email`**
- **Found during:** Task 2 verification (`pnpm test:integration`)
- **Issue:** `users.ts` declared `email: text('email').notNull().unique()` AND a separate `uniqueIndex('users_email_unique').on(t.email)` in the table extras. Drizzle generated both `CONSTRAINT "users_email_unique" UNIQUE("email")` (which auto-creates an index of the same name) AND `CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email")`, producing a `relation "users_email_unique" already exists` error on the very first migration. The error surfaced because `drizzle-orm/postgres-js/migrator` runs all statements inside a single transaction — the failed `CREATE UNIQUE INDEX` rolled back the whole migration, leaving `__migrations` empty. Subsequent runs re-attempted the failing migration → hit the same error.
- **Fix:** Removed the column-level `.unique()`; kept the explicit `uniqueIndex(...)` in the table extras (matches RESEARCH.md and is more flexible — same pattern as the partial index on `cpf_hash`). Discarded the old migration (`0000_nifty_bastion.sql`) and re-generated as `0000_premium_sabretooth.sql`.
- **Files modified:** `src/db/schema/users.ts`, `src/db/migrations/0000_premium_sabretooth.sql`, `src/db/migrations/meta/{_journal.json,0000_snapshot.json}`
- **Commit:** `749d494` (single commit because Task 2 verification revealed it)

### Architectural Notes

- No Rule 4 stops triggered. The bug fix above is a pure schema authoring mistake.
- Drizzle Kit's auto-naming (`premium_sabretooth`) is deterministic per timestamp+content — re-running `pnpm db:generate` after another schema change will produce a `0001_*.sql` not a re-rolled `0000_*.sql`. Safe.

### Deferred Items

- **None for this plan.** Task 3 is intentionally human-action — Railway provisioning has no public API for region selection at project create time.

## Authentication / Human-Action Gates

**Task 3 — Railway sa-east-1 provisioning + live schema push** is a `checkpoint:human-action` gate. The runbook (`docs/ops/railway-setup.md`) provides the full procedure. The developer must:

1. Verify Railway offers `sa-east-1` at project creation (HALT if not).
2. Provision the 3-service topology (`postgres`, `web`, `worker`) in `sa-east-1`.
3. Set the env-var matrix (DATABASE_URL reference, NEXTAUTH_SECRET, ENCRYPTION_KEY, CPF_HASH_PEPPER, SENTRY_DSN, SENTRY_ENV, NODE_ENV) on web + worker.
4. Run `DATABASE_URL=... pnpm db:migrate` (or wire it as a Railway predeploy on the web service only).
5. Verify with `psql -c "\dt public.*"` — expect all 14 tables, NO `accounts`.

Resume signal: type `schema pushed` once the live DB carries all 14 tables in sa-east-1. If sa-east-1 is unavailable, type `blocked` per STATE.md blocker.

## Threat Surface

No new surface introduced beyond what the threat model covered:

- **T-MIGRATION-DRIFT** mitigated — package.json contains `db:generate` + `db:migrate` only, no `db:push` script. The runbook also documents the ban.
- **T-RESIDENCY** awaiting Task 3 human verification — runbook gates explicitly on sa-east-1.
- **T-SCHEMA-COLLISION** mitigated — `tests/integration/db/migrations.test.ts` asserts `accounts` table does not exist.
- **T-PGCRYPTO-MISSING** mitigated — runner creates extension before migrate; test asserts presence.
- **T-SECRETS-LEAK** unchanged — runbook documents env vars are entered in Railway dashboard only; `.gitignore` (Wave 0) covers `.env*`.
- **T-CPF-PREMATURE-ENCRYPT** accepted for Phase 1 — schema test asserts both `cpf_hash` and `cpf_enc` are nullable.

## Verification Gate

| Check                                                         | Result | Notes                                                     |
| ------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `pnpm typecheck`                                              | PASS   | Clean                                                     |
| `pnpm db:generate`                                            | PASS   | Produced `0000_premium_sabretooth.sql`                    |
| `pnpm test:integration -- db/migrations.test.ts db/users-schema.test.ts` | PASS | 10 tests, 7.0 s total (testcontainers Postgres 16-alpine) |
| Migration idempotence (run twice)                             | PASS   | information_schema snapshot identical                     |
| All 14 Phase 1 tables present                                 | PASS   | Asserted in test                                          |
| No `accounts` table (Pluggy collision avoided)                | PASS   | Asserted in test                                          |
| `webhook_events` UNIQUE(source, event_id) present             | PASS   | Asserted via pg_indexes                                   |
| `users.subscription_tier` default = `'paid'`                  | PASS   | Asserted in test                                          |
| `users.cpf_hash` and `users.cpf_enc` nullable                 | PASS   | Asserted in test                                          |
| `pgcrypto` extension created                                  | PASS   | Asserted in test                                          |
| Schema pushed to Railway sa-east-1                             | PENDING | Task 3 human-action gate                                  |

## Self-Check: PASSED

Verified the following exist on disk and have non-empty content:
- `drizzle.config.ts`, `src/db/index.ts`, `src/db/migrate.ts`
- 13 schema files in `src/db/schema/` plus `_shared.ts` and `index.ts`
- `src/db/migrations/0000_premium_sabretooth.sql`
- `src/db/migrations/meta/_journal.json`, `meta/0000_snapshot.json`
- `tests/integration/db/migrations.test.ts`, `tests/integration/db/users-schema.test.ts`
- `docs/ops/railway-setup.md`

Verified the following commits exist in `git log master`:
- `406bfbf` (Task 1)
- `749d494` (Task 2)
