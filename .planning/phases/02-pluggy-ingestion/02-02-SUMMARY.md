---
phase: 02-pluggy-ingestion
plan: "02"
subsystem: service-layer
tags: [pluggy, service, crypto, audit, consent, fixtures, tdd]
dependency_graph:
  requires: [02-01]
  provides: [pluggy-service, pluggy-env, audit-phase2-events, consent-pluggy-scopes, pluggy-fixtures]
  affects: [02-03, 02-04, 02-05, 02-06]
tech_stack:
  added: []
  patterns:
    - "decrypt-on-use: PluggyService is the ONLY module that decrypts pluggy_item_id"
    - "scrub_plaintext() strips itemId from SDK error messages before re-throw"
    - "Sentry.startSpan wraps every public PluggyService method (Pattern S8)"
    - "hashPluggyItemId uses distinct PLUGGY_ITEM_ID_HASH_PEPPER (defense-in-depth, OQ#6)"
    - "consentVersions.getPluggyConsentVersionHash() computes SHA-256(privacy+tos+'pluggy_connect_v1') at module load"
key_files:
  created:
    - src/services/PluggyService.ts
    - src/lib/pluggyEnv.ts
    - tests/unit/services/PluggyService.test.ts
    - tests/unit/lib/crypto-pluggy.test.ts
    - tests/integration/pluggy/encryption.test.ts
    - tests/fixtures/pluggy/webhook-item-created.json
    - tests/fixtures/pluggy/webhook-item-error.json
    - tests/fixtures/pluggy/webhook-transactions-created.json
    - tests/fixtures/pluggy/list-accounts.json
    - tests/fixtures/pluggy/list-transactions-page.json
    - tests/fixtures/pluggy/list-transactions-cursor.json
  modified:
    - src/lib/crypto.ts
    - src/lib/consentScopes.ts
    - src/lib/consentVersions.ts
    - src/db/schema/auditLog.ts
    - tests/unit/lib/env.test.ts
decisions:
  - "createConnectToken returns { accessToken: string } only — SDK type has NO expiresAt field; PluggyService.createConnectToken return type corrected to { connect_token: string } (no expires_at)"
  - "TransactionCursorFilters uses dateFrom (not from/to) and after (not cursor) — adapted fetchTransactions args to match SDK actual types"
  - "CursorPageResponse uses .next (not .nextCursor) — adapted logging and test assertions"
  - "getScopeConfig('PLUGGY_CONNECTOR:xxx') now returns PLUGGY_CONNECT_PENDING config per plan spec (previously returned PLUGGY_CONNECTOR_TEMPLATE with different copy)"
  - "env.test.ts two production-shape tests updated to include Pluggy OPS-04 vars (Rule 1 bug fix for tests broken by plan 02-01 refine addition)"
metrics:
  duration: "619 seconds (~10 minutes)"
  completed: "2026-05-02"
  tasks: 1
  files: 16
---

# Phase 02 Plan 02: Service Layer + Substrate Summary

PluggyService built as the single decrypt boundary with Sentry spans, hashed-ID logging, and scrub_plaintext error sanitization; hashPluggyItemId, auditLog Phase 2 events, Pluggy consent scopes, and Wave 0 test fixtures all wired.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Build PluggyService + pluggyEnv + extend consentScopes/consentVersions/auditLog with TDD coverage | `d5c5913` | src/lib/crypto.ts, src/lib/pluggyEnv.ts, src/services/PluggyService.ts, src/lib/consentScopes.ts, src/lib/consentVersions.ts, src/db/schema/auditLog.ts, tests/unit/lib/env.test.ts, tests/unit/lib/crypto-pluggy.test.ts, tests/unit/services/PluggyService.test.ts, tests/integration/pluggy/encryption.test.ts, 6x tests/fixtures/pluggy/*.json |

## SDK Method Names Used (for 02-03..02-06 consumption)

| PluggyService Method | SDK Call | SDK Return Type | Notes |
|---|---|---|---|
| `createConnectToken({ user_id, reconnect_item_id_enc? })` | `PluggyClient.createConnectToken(itemId?)` | `{ accessToken: string }` | No `expiresAt` in SDK types |
| `fetchItem({ user_id, item_id_enc })` | `PluggyClient.fetchItem(id)` | `ItemResponse` | — |
| `fetchAccounts({ user_id, item_id_enc })` | `PluggyClient.fetchAccounts(itemId)` | `{ results: AccountResponse[] }` | — |
| `fetchTransactions({ user_id, item_id_enc, account_id, date_from, cursor? })` | `PluggyClient.fetchTransactionsCursor(accountId, { dateFrom, after? })` | `CursorPageResponse<Transaction>` | Uses `result.next` (not `nextCursor`) |
| `deleteItem({ user_id, item_id_enc })` | `PluggyClient.deleteItem(id)` | `void` | — |

**CRITICAL for plans 02-03..02-06:**
- `fetchTransactionsCursor` options: `{ dateFrom?, createdAtFrom?, after? }` (NOT `from`/`to`/`cursor`)
- `CursorPageResponse<T>` shape: `{ results: T[]; next: string | null }` (NOT `nextCursor`)

## Test Counts

| Suite | File | Tests | Result |
|---|---|---|---|
| Unit | tests/unit/services/PluggyService.test.ts | 7 | PASS |
| Unit | tests/unit/lib/crypto-pluggy.test.ts | 3 | PASS |
| Integration | tests/integration/pluggy/encryption.test.ts | 4 | PASS |
| All unit | tests/unit/**/*.test.ts | 64 | PASS |

## Fixture Files

| File | Description |
|---|---|
| `webhook-item-created.json` | Pluggy `item/created` webhook payload with eventId `evt_001` |
| `webhook-item-error.json` | Pluggy `item/error` webhook with `USER_INPUT_TIMEOUT` error code |
| `webhook-transactions-created.json` | Pluggy `transactions/created` with 2 transaction IDs |
| `list-accounts.json` | 2-account response: CHECKING + CREDIT_CARD with BRL balances and fake CNPJs |
| `list-transactions-page.json` | 8-transaction cursor page with `nextCursor: "cursor_001"` — covers DEBIT/CREDIT, POSTED/PENDING, PIX/BOLETO/CARD payment methods |
| `list-transactions-cursor.json` | 3-transaction final page with `nextCursor: null` |

All fixtures use obviously fake data (00.000.000/0000-00 CNPJs, "TESTE" entity names — no real PII).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SDK type mismatch — createConnectToken return shape**
- **Found during:** Task 1 Step 5 (TypeScript typecheck after PluggyService creation)
- **Issue:** Plan spec used `{ connect_token, expires_at }` but pluggy-sdk@0.85.2 type declaration shows `createConnectToken` returns only `{ accessToken: string }` — no `expiresAt` field.
- **Fix:** Corrected `PluggyService.createConnectToken` return type to `{ connect_token: string }`. Updated unit tests accordingly.
- **Files modified:** `src/services/PluggyService.ts`, `tests/unit/services/PluggyService.test.ts`
- **Commit:** `d5c5913`

**2. [Rule 1 - Bug] SDK type mismatch — TransactionCursorFilters and CursorPageResponse shape**
- **Found during:** Task 1 Step 5 (TypeScript typecheck — 3 errors reported)
- **Issue:** Plan spec used `from`/`to` date args and `cursor` in options, and `result.nextCursor`. Actual SDK types use `dateFrom` (not `from`/`to`), `after` (not `cursor`), and `result.next` (not `result.nextCursor`).
- **Fix:** Adapted `fetchTransactions` method args (`date_from` replaces `from`/`to`) and SDK call options to match SDK actual types.
- **Files modified:** `src/services/PluggyService.ts`
- **Commit:** `d5c5913`

**3. [Rule 1 - Bug] Integration test insertItemRow — wrong column name + non-unique cpf_hash**
- **Found during:** Task 1 Step 7 (running integration test — PostgresError)
- **Issue:** Test used `email_normalized` column (doesn't exist in users schema) and a constant `Buffer.alloc(32, 1)` for `cpf_hash` causing UNIQUE constraint violations on repeated inserts.
- **Fix:** Removed `email_normalized` from INSERT; replaced constant buffer with `randomBytes(32)` for `cpf_hash` and `randomBytes(44)` for `cpf_enc`.
- **Files modified:** `tests/integration/pluggy/encryption.test.ts`
- **Commit:** `d5c5913`

**4. [Rule 1 - Bug] env.test.ts production tests broken by plan 02-01 OPS-04 Pluggy refine**
- **Found during:** Task 1 (running full unit test suite — 2 failures in env.test.ts)
- **Issue:** Two tests in `SEC-02 + Plan 01.1-03 prereq` describe block pass production `NODE_ENV` but don't include `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_WEBHOOK_SECRET`, `PLUGGY_ENV=production`, or `PLUGGY_ITEM_ID_HASH_PEPPER` — all now required by the OPS-04 refine added in plan 02-01.
- **Fix:** Added the missing Pluggy production vars to both affected test cases.
- **Files modified:** `tests/unit/lib/env.test.ts`
- **Commit:** `d5c5913`

## Known Stubs

None — all implemented functionality is complete for plan 02-02 scope.

Note: `PluggyService.fetchTransactions` now uses `date_from` (singular) instead of `from`/`to` — callers in plans 02-03/02-04 must use `date_from: Date` arg, not the plan spec's `from`/`to` shape. The cursor field for next-page is `result.next` (string | null) per SDK types.

## Threat Flags

No new security-relevant surfaces beyond those declared in the plan's `<threat_model>`. T-02-A through T-02-E mitigations all implemented:
- T-02-A: logger.info calls use only hashed IDs (proven by Test 3)
- T-02-B: scrub_plaintext() strips itemId from error messages (proven by Test 4)
- T-02-C: encryption integration test asserts ciphertext ≠ plaintext (4 assertions)
- T-02-D: recordAudit() metadata scrubObject runs at call site
- T-02-E: getPluggyClientId/Secret reads from env via pluggyEnv.ts

## Self-Check

- `src/services/PluggyService.ts` — FOUND
- `src/lib/pluggyEnv.ts` — FOUND
- `src/lib/crypto.ts` (hashPluggyItemId export) — FOUND
- `src/db/schema/auditLog.ts` (8 Phase 2 event types) — FOUND
- `src/lib/consentScopes.ts` (PLUGGY_CONNECT_PENDING) — FOUND
- `src/lib/consentVersions.ts` (pluggy_connect_v1) — FOUND
- `tests/fixtures/pluggy/*.json` (6 files) — FOUND
- `tests/unit/services/PluggyService.test.ts` (7 tests) — PASS
- `tests/unit/lib/crypto-pluggy.test.ts` (3 tests) — PASS
- `tests/integration/pluggy/encryption.test.ts` (4 tests) — PASS
- All 64 unit tests — PASS
- TypeScript typecheck — PASS (0 errors)
- Commit `d5c5913` — FOUND
