---
phase: 02-pluggy-ingestion
plan: "01"
subsystem: schema
tags: [pluggy, schema, drizzle, pg-boss, env, migrations]
dependency_graph:
  requires: [01-04]
  provides: [pluggy-sdk-installed, phase2-schema, phase2-queues, phase2-env-validation]
  affects: [02-02, 02-03, 02-04, 02-05, 02-06]
tech_stack:
  added:
    - "pluggy-sdk@0.85.2"
    - "react-pluggy-connect@2.12.0"
    - "date-fns@^4.1.0"
  patterns:
    - "pgEnum declarations in _shared.ts barrel for Drizzle Kit discovery"
    - "Random placeholder bytes for NOT NULL cpf_hash/cpf_enc at signup"
    - "Lazy self-FK pattern for transactions.transfer_pair_id"
key_files:
  created:
    - src/db/schema/pluggyItems.ts
    - src/db/schema/accounts.ts
    - src/db/schema/transactions.ts
    - src/db/migrations/0001_02_pluggy_ingestion.sql
    - .env.example
  modified:
    - src/db/schema/_shared.ts
    - src/db/schema/index.ts
    - src/db/schema/users.ts
    - src/lib/env.ts
    - src/jobs/boss.ts
    - scripts/run-e2e.ts
    - docs/ops/aws-copilot-setup.md
    - src/app/(auth)/signup/signupCore.ts
decisions:
  - "pgEnum declarations must be exported from the schema barrel (index.ts → _shared.ts) for Drizzle Kit to discover them — discovered during migration generation (types were absent from migration SQL without barrel re-export)"
  - "cpf_hash/cpf_enc NOT NULL in Drizzle schema requires signupCore.ts to seed random placeholder bytes at signup time; connect flow (plan 02-02) replaces them with real CPF values via UPDATE"
  - "pluggy-sdk@0.85.2 uses fetch* method names (fetchItem, fetchAccounts, fetchTransactions, fetchTransactionsCursor) — NOT list* (verified by node -e introspection)"
  - "date-fns resolved to ^4.1.0 (latest) since no version was pinned in the plan; plan 02-05 can pin if API differences are discovered"
metrics:
  duration: "565 seconds (~9.4 minutes)"
  completed: "2026-05-02"
  tasks: 2
  files: 13
---

# Phase 02 Plan 01: Schema + SDK + Env Substrate Summary

Drizzle schemas for Phase 2 Pluggy ingestion laid down: 5 pgEnums, 3 new tables (pluggy_items, accounts, transactions), single migration file covering all schema changes including CPF NOT NULL, 5 Phase 2 pg-boss queues registered, Pluggy SDK installed, env.ts extended with production OPS-04 refine.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install Pluggy SDKs + date-fns; extend env.ts; register Phase 2 queues; update e2e env block | `65c88fc` | package.json, pnpm-lock.yaml, src/lib/env.ts, src/jobs/boss.ts, scripts/run-e2e.ts, .env.example, docs/ops/aws-copilot-setup.md |
| 2 | Declare pgEnums + 3 schema files + barrel update + generate Phase 2 migrations + CPF NOT NULL migration | `63ca848` | src/db/schema/{_shared,pluggyItems,accounts,transactions,index,users}.ts, src/db/migrations/0001_02_pluggy_ingestion.sql, src/app/(auth)/signup/signupCore.ts |

## Verification Results

### pluggy-sdk Method Name Verification (Task 1 Step 2)

Method names verified via `node -e "const m = require('pluggy-sdk'); ... console.log([...].map(k => k in c).join(','))"`:

```
createConnectToken,fetchItem,fetchAccounts,fetchTransactions,deleteItem → all true
```

**Complete SDK method list** (for plan 02-02 consumption):
`fetchConnectors`, `fetchConnector`, `fetchItem`, `validateParameters`, `createItem`, `updateItem`, `updateItemMFA`, `deleteItem`, `fetchAccounts`, `fetchAccount`, `fetchTransactions`, `fetchTransactionsCursor`, `fetchAllTransactions`, `fetchAccountStatements`, `updateTransactionCategory`, `fetchTransaction`, `fetchInvestments`, `fetchInvestment`, `fetchInvestmentTransactions`, `fetchLoans`, `fetchLoan`, `fetchConsents`, `fetchConsent`, `fetchIdentity`, `fetchIdentityByItemId`, `fetchCreditCardBills`, `fetchCreditCardBill`, `fetchCategories`, `fetchCategory`, `fetchWebhook`, `fetchWebhooks`, `createWebhook`, `updateWebhook`, `deleteWebhook`, `createConnectToken`

**Critical for plan 02-02:** Cursor pagination uses `fetchTransactionsCursor` (NOT `fetchTransactions`). The plan mentions `listTransactions` — this does NOT exist in the SDK. Plan 02-02 must use `fetchTransactionsCursor` for paginated sync.

### Dependency Installation

- `pluggy-sdk@0.85.2` — installed at locked version. No `--legacy-peer-deps` required.
- `react-pluggy-connect@2.12.0` — installed at locked version. The `pluggy-js` peer-dep warning appeared in pnpm output but did NOT block installation (benign, as RESEARCH.md Pitfall 2 documented).
- `date-fns` — resolved to `^4.1.0` (latest). No specific version was pinned in the plan.

### Migration Generated

**File:** `src/db/migrations/0001_02_pluggy_ingestion.sql`

Migration contents:
1. `CREATE TYPE public.item_status AS ENUM(...)` — 5 values
2. `CREATE TYPE public.account_type AS ENUM(...)` — 6 values
3. `CREATE TYPE public.account_status AS ENUM(...)` — 3 values
4. `CREATE TYPE public.tx_status AS ENUM(...)` — 2 values
5. `CREATE TYPE public.tx_type AS ENUM(...)` — 2 values
6. `CREATE TABLE pluggy_items` — 14 columns
7. `CREATE TABLE accounts` — 14 columns
8. `CREATE TABLE transactions` — 22 columns
9. `DROP INDEX users_cpf_hash_unique` (removes partial WHERE clause)
10. `ALTER TABLE users ALTER COLUMN cpf_hash SET NOT NULL`
11. `ALTER TABLE users ALTER COLUMN cpf_enc SET NOT NULL`
12. FK constraints (6 total)
13. Indexes: pluggy_items (2), accounts (2), transactions (4 including partial)

### Testcontainer Migration Verification

Migration applied successfully to `postgres:16-alpine` via `@testcontainers/postgresql`:

- Tables created: `accounts`, `pluggy_items`, `transactions`
- Partial index: `CREATE INDEX transactions_user_posted_real_idx ON public.transactions USING btree (user_id, posted_at DESC NULLS LAST) WHERE ((is_transfer = false) AND (is_credit_card_payment = false))`
- CPF columns: `cpf_hash` is_nullable=NO, `cpf_enc` is_nullable=NO

### Build Status

`npm run build` exits 0 — all TypeScript types from new schema imports compile.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pgEnum declarations not discovered by Drizzle Kit**
- **Found during:** Task 2 Step 7 (migration generation)
- **Issue:** Drizzle Kit generated migration SQL referencing enum types (e.g., `"item_status"`) but without `CREATE TYPE` statements. Inspection of the migration snapshot showed `"enums": {}`. The pgEnum declarations in `_shared.ts` were not being exported from the schema barrel.
- **Fix:** Added `export * from './_shared'` as the first export in `src/db/schema/index.ts`. Drizzle Kit requires all schema objects (tables AND enums) to be reachable via the configured schema barrel file.
- **Files modified:** `src/db/schema/index.ts`
- **Commit:** `63ca848`

**2. [Rule 1 - Bug] TypeScript compilation error from cpf_hash/cpf_enc NOT NULL schema change**
- **Found during:** Task 2 Step 6 (users.ts update) — TypeScript reported missing required fields on signupCore.ts INSERT
- **Issue:** Making `cpf_hash` and `cpf_enc` NOT NULL in the Drizzle schema causes `$inferInsert` to require these fields. The signup flow (per D-02 architecture) does NOT collect CPF — CPF is captured on the connect/consent screen in plan 02-02.
- **Fix:** Updated `signupCore.ts` to seed `cpf_hash` and `cpf_enc` with random placeholder bytes (32 bytes for hash, 44 bytes for enc placeholder). Plan 02-02's connect flow will UPDATE these with real values via AES-256-GCM encrypt + HMAC-SHA-256 hash.
- **Files modified:** `src/app/(auth)/signup/signupCore.ts`
- **Commit:** `63ca848`
- **Note:** The random placeholders ensure the UNIQUE constraint on `users_cpf_hash_unique` does not collide across signups. The connect flow's UPDATE replaces both fields atomically with the real CPF values.

**3. [Rule 3 - Blocking] Migration numbering collision during regeneration**
- **Found during:** Task 2 Step 7 regeneration after fixing enum export
- **Issue:** After deleting the first generated migration (which lacked CREATE TYPE) and regenerating, Drizzle Kit emitted `0002_02_pluggy_ingestion.sql` because the journal still had the `0001_` entry. The snapshot was also numbered 0002.
- **Fix:** Renamed `0002_*.sql` → `0001_*.sql` and `0002_snapshot.json` → `0001_snapshot.json`, updated the journal to remove the stale 0001 entry and rename the 0002 entry to 0001.
- **Files modified:** `src/db/migrations/meta/_journal.json`, migration files renamed

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `cpf_hash` and `cpf_enc` placeholder bytes at signup | `src/app/(auth)/signup/signupCore.ts` | 64-78 | Architecture: CPF collected on connect screen (D-02), not signup. Plan 02-02 replaces via UPDATE in `/api/pluggy/items` handler. |

## Threat Flags

No new security-relevant surfaces introduced beyond what is declared in the plan's `<threat_model>`. The enum types, schema tables, and migration runner operate within the existing DB trust boundary. The env.ts OPS-04 refine extension (T-02-D) is implemented as designed.

## Self-Check: PASSED

- `src/db/schema/pluggyItems.ts` — FOUND
- `src/db/schema/accounts.ts` — FOUND
- `src/db/schema/transactions.ts` — FOUND
- `src/db/migrations/0001_02_pluggy_ingestion.sql` — FOUND
- `.env.example` — FOUND
- Commit `65c88fc` — FOUND
- Commit `63ca848` — FOUND
- `npm run build` exits 0 — CONFIRMED
- Testcontainer migration applied successfully — CONFIRMED
