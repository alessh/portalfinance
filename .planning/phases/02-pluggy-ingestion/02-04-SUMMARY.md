---
phase: 02-pluggy-ingestion
plan: "04"
subsystem: pluggy-ingestion
tags: [pluggy, webhook, worker, sync, idempotency, encryption, tdd]

dependency_graph:
  requires: [02-01, 02-02]
  provides: [webhook-receiver, pluggy-sync-worker, transaction-upsert, reauth-audit]
  affects: [02-05, 02-06]

tech_stack:
  added: []
  patterns:
    - "timingSafeEqual for constant-time webhook signature comparison (T-02-A)"
    - "onConflictDoNothing for webhook event idempotency"
    - "onConflictDoUpdate for transaction upsert — preserves is_transfer/is_credit_card_payment/transfer_pair_id"
    - "Pluggy CursorPageResponse.next for cursor pagination (NOT nextCursor)"
    - "Transaction.date is Date object (not string) — no conversion needed"
    - "BOSS_TEST_MODE=1 + peekQueue/drainQueue for pg-boss integration tests"
    - "vi.doMock + vi.resetModules for module-level PluggyService mock in testcontainers tests"
    - "Sentry.startSpan wrapping sync span (Pattern S8)"
    - "D-13: item_reauth_succeeded audit emitted inline at webhook receipt"
    - "D-30: trigger=reconnect for item/login_succeeded; 12-month window bypass cooldown"

key_files:
  created:
    - src/app/api/webhooks/pluggy/route.ts
    - src/jobs/workers/pluggySyncWorker.ts
    - docs/ops/cloudflare-waf-pluggy.md
    - tests/integration/pluggy/webhook.test.ts
    - tests/integration/pluggy/sync-worker.test.ts
    - tests/integration/pluggy/reauth-flow.test.ts
  modified:
    - src/jobs/worker.ts
    - tests/fixtures/pluggy/list-transactions-page.json
    - tests/fixtures/pluggy/list-transactions-cursor.json

decisions:
  - "mapAccountType: BANK->CHECKING, CREDIT->CREDIT_CARD, LOAN->LOAN, INVESTMENT->INVESTMENT, default->OTHER"
  - "ON CONFLICT upsert for transactions must NOT touch is_transfer/is_credit_card_payment/transfer_pair_id — set by detector workers in 02-05"
  - "item/login_succeeded enqueues PLUGGY_SYNC (not PLUGGY_REAUTH_NOTIFIER) with trigger=reconnect + 12-month date window"
  - "item_reauth_succeeded audit inserted inline at webhook receipt (D-13), not deferred to worker"
  - "hashPluggyItemId uses HMAC-SHA256 with PLUGGY_ITEM_ID_HASH_PEPPER (distinct from CPF pepper)"
  - "Unknown webhook event types: insert row + log pluggy_webhook_unmapped_event, no job enqueued"

metrics:
  duration: "~90 minutes"
  completed: "2026-05-02"
  tasks_completed: 2
  files_created: 6
  files_modified: 3
---

# Phase 02 Plan 04: Pluggy Webhook Receiver + Sync Worker Summary

Inbound Pluggy ingestion pipeline with constant-time webhook auth, idempotent event insert, cursor-paginated transaction upsert, and full TDD RED/GREEN cycle.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Webhook receiver + WAF runbook + integration tests | e10df14 | `src/app/api/webhooks/pluggy/route.ts`, `docs/ops/cloudflare-waf-pluggy.md`, `tests/integration/pluggy/webhook.test.ts` |
| 2 TDD RED | Failing sync worker + reauth flow tests | c657843 | `tests/integration/pluggy/sync-worker.test.ts`, `tests/integration/pluggy/reauth-flow.test.ts` |
| 2 TDD GREEN | pluggySyncWorker implementation + worker.ts registration | bbf31b6 | `src/jobs/workers/pluggySyncWorker.ts`, `src/jobs/worker.ts` |

## Deliverables

### Task 1 — Webhook Receiver

`POST /api/webhooks/pluggy` (runtime: nodejs):
- `X-Pluggy-Signature` verified with `timingSafeEqual` (constant-time — prevents timing attacks T-02-A)
- Idempotent insert into `webhook_events` with `onConflictDoNothing()` on `(source, event_id)`
- `mapEventToQueue()` routes Pluggy event types to pg-boss queues:
  - `item/{created,updated,login_succeeded}` + `transactions/{created,updated,deleted}` → `QUEUES.PLUGGY_SYNC`
  - `item/{error,waiting_user_input}` → `QUEUES.PLUGGY_REAUTH_NOTIFIER`
  - `item/deleted`, `connector/status_updated`, unknown types → no job (row still inserted, unknown types log `pluggy_webhook_unmapped_event`)
- D-13: `item/login_succeeded` inserts `item_reauth_succeeded` audit inline (not deferred)
- D-30: `item/login_succeeded` payload includes `trigger: 'reconnect'` for 12-month window
- PII guard: logger emits only `event_type`, `latency_ms`, `was_duplicate` — no raw itemId/eventId

7 integration test scenarios (testcontainers + Drizzle migrations + BOSS_TEST_MODE=1):
- a: missing signature → 401
- b: wrong signature → 401
- c: valid `item/updated` → 200, 1 webhook_events row, 1 PLUGGY_SYNC job
- d: replay same eventId → 200, still 1 row, still 1 job (idempotency)
- e: `item/error` → PLUGGY_REAUTH_NOTIFIER enqueued
- f: unknown event type → 200, row inserted, no job, `pluggy_webhook_unmapped_event` logged
- g: `item/login_succeeded` → PLUGGY_SYNC with `trigger=reconnect`, `item_reauth_succeeded` audit in `audit_log`

### Task 2 — pluggySyncWorker (TDD)

`pluggySyncWorker` handles batches of `Job<SyncJobPayload>[]`:
1. Resolves `pluggy_item` row (UUID or `hashPluggyItemId` lookup)
2. Skips items with `status='LOGIN_ERROR'` or `'WAITING_USER_INPUT'` (P2)
3. D-30: if `trigger==='reconnect'` → `recordAudit('manual_sync_triggered')` FIRST
4. Sets `status='UPDATING'`
5. Sentry `startSpan` wrapping:
   - `fetchAccounts()` → `onConflictDoUpdate` on `pluggy_account_id`
   - date window: first-connect/reconnect → 12 months ago; incremental → `last_synced_at - 7d`
   - cursor loop: `fetchTransactionsCursor()` → `onConflictDoUpdate` on `pluggy_transaction_id` (does NOT touch `is_transfer`/`is_credit_card_payment`/`transfer_pair_id`)
6. Sets `status='UPDATED'`, `last_synced_at=now()`
7. Enqueues `PLUGGY_TRANSFER_DETECTOR` + `PLUGGY_FATURA_DETECTOR`

`mapAccountType()`: BANK→CHECKING, CREDIT→CREDIT_CARD, LOAN→LOAN, INVESTMENT→INVESTMENT, default→OTHER

6 integration test scenarios:
- sync-1: 2-page cursor pagination → 11 transactions, status=UPDATED, detectors enqueued
- sync-2: run twice → still 11 rows (TX-01 dedup via ON CONFLICT)
- sync-3: PENDING→POSTED transition, `is_transfer`/`is_credit_card_payment` preserved (TX-02, T-02-E)
- sync-4: LOGIN_ERROR item → fetchAccounts NOT called, detectors NOT enqueued
- reauth-flow-1: item/login_succeeded webhook → audit_log with `action='item_reauth_succeeded'`, `metadata.item_id_hashed`
- reauth-flow-2: worker `trigger=reconnect` → `recordAudit:manual_sync_triggered` index < `fetchTransactions` index

`worker.ts` registration:
```
await boss.work(QUEUES.PLUGGY_SYNC, { localConcurrency: 4 }, pluggySyncWorker);
```
Comment documents singletonKey (D-41) prevents same user having >1 sync in flight.

### Cloudflare WAF Runbook

`docs/ops/cloudflare-waf-pluggy.md`: Step-by-step WAF rule restricting `/api/webhooks/pluggy` to Pluggy IP `177.71.238.212`. Marked as manual deployment (not blocking for plan acceptance).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixture files used `nextCursor` instead of `next`**
- Found during: Task 2 TDD GREEN
- Issue: `list-transactions-page.json` had `"nextCursor": "cursor_001"` and `list-transactions-cursor.json` had `"nextCursor": null`. The actual `pluggy-sdk` `CursorPageResponse<T>` type uses `.next` (documented in 02-02-SUMMARY "SDK actual method signatures").
- Fix: Updated both fixture JSON files to `"next": "cursor_001"` and `"next": null`
- Files modified: `tests/fixtures/pluggy/list-transactions-page.json`, `tests/fixtures/pluggy/list-transactions-cursor.json`
- Commit: bbf31b6

**2. [Rule 1 - Bug] TypeScript error — `Transaction.date` is `Date` not `string`**
- Found during: Task 2 TDD GREEN
- Issue: Initial map callback used explicit type annotation `(t: { date: string; ... })` — but the SDK's `Transaction.date` is a `Date` object (verified in `pluggy-sdk/dist/types/transaction.d.ts`).
- Fix: Imported `type { Transaction as PluggyTransaction } from 'pluggy-sdk'` and cast `tx_resp.results as PluggyTransaction[]`. Used `t.date` directly (already a `Date`), removed `new Date(t.date)` conversion.
- Files modified: `src/jobs/workers/pluggySyncWorker.ts`
- Commit: bbf31b6

**3. [Rule 1 - Bug] Test item status enum included non-existent values**
- Found during: Task 2 TDD RED
- Issue: Test seed used `status: 'CREATED' | 'OUTDATED_USER_AUTH' | 'STALE'` — values that do not exist in `item_status_enum`. The enum has exactly 5 values: `UPDATING | LOGIN_ERROR | OUTDATED | WAITING_USER_INPUT | UPDATED`.
- Fix: Narrowed cast to `'UPDATED' | 'LOGIN_ERROR' | 'WAITING_USER_INPUT' | 'UPDATING' | 'OUTDATED'`
- Files modified: `tests/integration/pluggy/sync-worker.test.ts`
- Commit: bbf31b6

## TDD Gate Compliance

- RED gate commit: `c657843` — `test(02-04): add failing integration tests for pluggySyncWorker and reauth flow`
- GREEN gate commit: `bbf31b6` — `feature(pluggy-sync): implement pluggySyncWorker with cursor pagination, ON CONFLICT upsert, and worker.ts registration (TDD GREEN)`
- Both gates present in git log in correct order.

## Known Stubs

None — all data paths are wired. Worker reads from real `pluggy_items` table, calls real `PluggyService` methods (mocked in integration tests via `vi.doMock`), and writes to real `accounts`/`transactions` tables.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: webhook-auth | `src/app/api/webhooks/pluggy/route.ts` | Signature comparison uses `timingSafeEqual` — mitigated T-02-A |
| threat_flag: pii-log | `src/app/api/webhooks/pluggy/route.ts` | itemId never logged; only hashed form emitted in D-13 audit — mitigated T-02-B/P4 |

## Self-Check: PASSED

- `src/app/api/webhooks/pluggy/route.ts` — FOUND
- `src/jobs/workers/pluggySyncWorker.ts` — FOUND
- `docs/ops/cloudflare-waf-pluggy.md` — FOUND
- `tests/integration/pluggy/webhook.test.ts` — FOUND
- `tests/integration/pluggy/sync-worker.test.ts` — FOUND
- `tests/integration/pluggy/reauth-flow.test.ts` — FOUND
- Commit e10df14 — FOUND (webhook receiver)
- Commit c657843 — FOUND (TDD RED)
- Commit bbf31b6 — FOUND (TDD GREEN)
