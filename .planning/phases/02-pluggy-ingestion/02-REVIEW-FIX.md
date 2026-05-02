---
phase: 02-pluggy-ingestion
fixed_at: 2026-05-02T00:00:00Z
review_path: .planning/phases/02-pluggy-ingestion/02-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-02
**Source review:** `.planning/phases/02-pluggy-ingestion/02-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 8 (3 critical + 5 warning)
- Fixed: 8
- Skipped: 0

All 4 Info-severity findings (IN-01..IN-04) were out of scope (`fix_scope: critical_warning`) and remain untouched in REVIEW.md for a future pass.

## Fixed Issues

### CR-01: Webhook signature compare is bypassable when `PLUGGY_WEBHOOK_SECRET` is not set

**Files modified:** `src/app/api/webhooks/pluggy/route.ts`
**Commit:** `b8793f2`
**Applied fix:** Reject the request with 503 + `pluggy_webhook_no_secret` log when `PLUGGY_WEBHOOK_SECRET` is unset, rather than comparing two empty buffers via `timingSafeEqual` (which would have accepted any signatureless request). Also reject empty signature headers explicitly even when the secret is configured.

### CR-02: Missing user_id IDOR guard when counting accounts in `GET /api/sync-status`

**Files modified:** `src/app/api/sync-status/route.ts`
**Commit:** `43d58e9`
**Applied fix:** Added `eq(accounts.user_id, session.userId)` to the WHERE clause of the account count query so the IDOR contract (P26) is explicit and parallel to the transaction count below. `and()` was already imported.

### CR-03: Unvalidated `cursor` search parameter used as SQL OFFSET — integer injection risk

**Files modified:** `src/app/transactions/page.tsx`
**Commit:** `30ae8af`
**Applied fix:** Validate the cursor value before passing to Drizzle's `.offset()`. `Number.isFinite(cursor_raw) && cursor_raw >= 0 ? Math.floor(cursor_raw) : 0` defends against `NaN`, negative values, and non-integer input that PostgreSQL would reject with a 500.

### WR-01: Race condition in disconnect flow — accounts soft-deleted before transaction history is preserved atomically

**Files modified:** `src/app/api/pluggy/items/[id]/route.ts`
**Commit:** `a599e6a`
**Applied fix:** Wrapped the soft-delete of accounts and the consent revocation insert in `db.transaction()` so the local state mutation flips atomically after the Pluggy DELETE call. Audit log insert remains outside the transaction (append-only; missing audit row is a smaller harm than rolling back the disconnect on audit failure).

### WR-02: `pluggySyncWorker` silently skips jobs when both `item_id` and `item_id_pluggy` are absent

**Files modified:** `src/jobs/workers/pluggySyncWorker.ts`
**Commit:** `f4ad3a9`
**Applied fix:** Added an explicit `else` arm to the payload resolution block that logs at error level with `reason='empty_payload'` and continues. We deliberately do not throw — the payload is unrecoverable, so re-throwing would just burn the pg-boss retry budget. The logger.error elevation surfaces miscoded enqueue calls that were previously swallowed by the `item_not_found` warn-level branch.

### WR-03: `accounts_pluggy_account_id_unique` index is global

**Files modified:**
- `src/db/migrations/0002_02_account_unique_per_user.sql` (new)
- `src/db/migrations/meta/0002_snapshot.json` (new)
- `src/db/migrations/meta/_journal.json`
- `src/db/schema/accounts.ts`
- `src/jobs/workers/pluggySyncWorker.ts`

**Commit:** `f900a80`
**Applied fix:** Added a NEW Drizzle migration (`0002_02_account_unique_per_user`) that drops the global unique index and recreates it as `UNIQUE (user_id, pluggy_account_id)`. The schema definition was updated to match and the upsert target in `pluggySyncWorker` now uses `[accounts.user_id, accounts.pluggy_account_id]`. We chose a new migration over editing `0001_02_pluggy_ingestion.sql` because the original migration may already have been applied to dev/staging; a forward migration is safe regardless of deployment state.

### WR-04: `console.error` in production client code leaks widget error messages

**Files modified:** `src/app/connect/ConnectIsland.tsx`
**Commit:** `1facd73`
**Applied fix:** Gated the `console.error` call inside `handleWidgetError` behind `process.env.NODE_ENV === 'development'`. The user-facing toast and state reset behaviour is unchanged. Pluggy connector codes and credential identifiers no longer reach the production browser console.

### WR-05: `getActiveItemCount` runs N+1 queries and incorrectly counts broken items as active

**Files modified:** `src/app/connect/page.tsx`
**Commit:** `8609147`
**Applied fix:** Replaced the 1+2N round-trip pattern with a single SQL aggregation that uses `db.execute(sql\`...\`)`. The new query also fixes the latent logic bug that counted items in `LOGIN_ERROR` / `WAITING_USER_INPUT` as active — those are now excluded, so a free user whose only connection is broken can still re-connect without hitting the 1-item paywall. The result-shape coalesce mirrors `transferDetectorWorker` to handle both postgres-js (`result[0]`) and node-postgres (`result.rows[0]`) drivers.

---

_Fixed: 2026-05-02_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
