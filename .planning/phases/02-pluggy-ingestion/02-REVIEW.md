---
phase: 02-pluggy-ingestion
reviewed: 2026-05-02T00:00:00Z
depth: standard
files_reviewed: 56
files_reviewed_list:
  - docs/ops/aws-copilot-setup.md
  - docs/ops/cloudflare-waf-pluggy.md
  - scripts/run-e2e.ts
  - src/app/(auth)/signup/signupCore.ts
  - src/app/api/connect/init/route.ts
  - src/app/api/pluggy/items/[id]/route.ts
  - src/app/api/pluggy/items/[id]/sync/route.ts
  - src/app/api/pluggy/items/route.ts
  - src/app/api/sync-status/route.ts
  - src/app/api/webhooks/pluggy/route.ts
  - src/app/connect/ConnectIsland.tsx
  - src/app/connect/page.tsx
  - src/app/connect/success/page.tsx
  - src/app/settings/connections/ConnectionsClient.tsx
  - src/app/settings/connections/page.tsx
  - src/app/transactions/FilterRow.tsx
  - src/app/transactions/page.tsx
  - src/components/banners/BannerStack.tsx
  - src/components/banners/ReAuthBanner.tsx
  - src/components/billing/PaywallStubCard.tsx
  - src/components/connect/PluggyConnectWidget.tsx
  - src/components/connect/SyncProgressCard.tsx
  - src/components/connections/ConnectionCard.tsx
  - src/components/connections/DisconnectConfirmModal.tsx
  - src/components/consent/ConsentScreen.tsx
  - src/components/layout/AuthenticatedShell.tsx
  - src/components/transactions/EmptyTransactions.tsx
  - src/components/transactions/TransactionList.tsx
  - src/components/ui/collapsible.tsx
  - src/components/ui/progress.tsx
  - src/components/ui/select.tsx
  - src/components/ui/tooltip.tsx
  - src/db/migrations/0001_02_pluggy_ingestion.sql
  - src/db/schema/_shared.ts
  - src/db/schema/accounts.ts
  - src/db/schema/auditLog.ts
  - src/db/schema/index.ts
  - src/db/schema/pluggyItems.ts
  - src/db/schema/transactions.ts
  - src/db/schema/users.ts
  - src/emails/ReAuthRequired.tsx
  - src/jobs/boss.ts
  - src/jobs/worker.ts
  - src/jobs/workers/faturaDetectorWorker.ts
  - src/jobs/workers/pluggySyncWorker.ts
  - src/jobs/workers/reAuthNotifierWorker.ts
  - src/jobs/workers/reconcileStaleItemsWorker.ts
  - src/jobs/workers/transferDetectorWorker.ts
  - src/lib/consentScopes.ts
  - src/lib/consentVersions.ts
  - src/lib/cpf.ts
  - src/lib/crypto.ts
  - src/lib/env.ts
  - src/lib/mailer.ts
  - src/lib/pluggyEnv.ts
  - src/services/PluggyService.ts
findings:
  critical: 3
  warning: 5
  info: 4
  total: 12
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-02
**Depth:** standard
**Files Reviewed:** 56
**Status:** issues_found

## Summary

Phase 2 (Pluggy ingestion) delivered a large surface: API routes for connect/disconnect/sync, a webhook receiver, five pg-boss workers, schema migrations, UI components, and supporting libs. The security-sensitive invariants (P3 constant-time webhook compare, P4 encrypted item IDs, P5 async-only sync, P26 IDOR guards) are correctly implemented across the board.

Three critical issues were found: a timing-side-channel bypass in the webhook signature check, a missing IDOR guard on the `accounts` table in the sync-status route, and an unvalidated `cursor` search parameter that is used directly as a SQL OFFSET with no bounds checking.

Five warnings include a race condition in the disconnect flow, a missing `err` propagation on the `run-e2e.ts` cleanup path, the `pluggySyncWorker` item resolution falling through silently when neither `item_id` nor `item_id_pluggy` is present, an `accounts_pluggy_account_id_unique` constraint scoped globally (not per-user), and the `console.error` call in `ConnectIsland` that leaks widget error messages to the browser console in production.

---

## Critical Issues

### CR-01: Webhook signature compare is bypassable when `PLUGGY_WEBHOOK_SECRET` is not set

**File:** `src/app/api/webhooks/pluggy/route.ts:94-101`

**Issue:** `env.PLUGGY_WEBHOOK_SECRET` is declared `.optional()` in `env.ts` (line 62). When the env var is absent (development, staging without the secret set, or a misconfiguration), `expected` becomes the empty string `""` and `sig_header` from the request is also compared against `""`. A request that sends an empty `X-Pluggy-Signature` header (or omits it, causing `?? ''` to yield `""`) will produce `sig_buf.length === exp_buf.length` (both 0) and `timingSafeEqual` succeeds — every such request passes authentication.

The OPS-04 production refine in `env.ts` (lines 175-192) does require `PLUGGY_WEBHOOK_SECRET` in production for `web`/`worker` services, so the actual production deployment is protected. However, staging environments without `NODE_ENV=production` receive no protection at all, and a single misconfigured production deployment (e.g., `SERVICE_NAME` set incorrectly) would open the hole silently.

**Fix:** Reject the request immediately when the secret is not configured rather than comparing two empty buffers:

```typescript
// At the top of POST, before any compare:
const expected = env.PLUGGY_WEBHOOK_SECRET;
if (!expected) {
  logger.error({ event: 'pluggy_webhook_no_secret' }, 'PLUGGY_WEBHOOK_SECRET not configured — rejecting all webhook requests');
  return new Response('service unavailable', { status: 503 });
}
const sig_header = req.headers.get('x-pluggy-signature') ?? '';
const sig_buf = Buffer.from(sig_header);
const exp_buf = Buffer.from(expected);
if (sig_buf.length === 0 || sig_buf.length !== exp_buf.length || !timingSafeEqual(sig_buf, exp_buf)) {
  logger.warn({ event: 'pluggy_webhook_signature_failed' }, 'invalid signature');
  return new Response('unauthorized', { status: 401 });
}
```

---

### CR-02: Missing user_id IDOR guard when counting accounts in `GET /api/sync-status`

**File:** `src/app/api/sync-status/route.ts:42-44`

**Issue:** After resolving the most recent `pluggy_items` row for the session user (correctly scoped), the route counts accounts with:

```typescript
.where(eq(accounts.pluggy_item_id, item.id))
```

`item.id` is the internal UUID of a `pluggy_items` row owned by `session.userId`, so this specific query is safe in practice. However, the subsequent transaction count at lines 48-51 scopes by `user_id` while the account count scopes only by `pluggy_item_id`. This asymmetry means that if a bug elsewhere were to surface a foreign `item.id` into this code path, account rows belonging to another user could be counted. More concretely, `accounts.user_id` column exists explicitly for this IDOR guard (P26) — it should be included in the WHERE clause for defense-in-depth and to make the intent explicit.

**Fix:** Add `user_id` to the account count WHERE clause:

```typescript
const accountCountResult = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(accounts)
  .where(
    and(
      eq(accounts.pluggy_item_id, item.id),
      eq(accounts.user_id, session.userId),  // P26 defense-in-depth
    )
  );
```

---

### CR-03: Unvalidated `cursor` search parameter used as SQL OFFSET — integer injection risk

**File:** `src/app/transactions/page.tsx:149,176`

**Issue:** The `cursor` search parameter is read from the URL and converted to a number with no validation:

```typescript
const cursor = Number(cursor_param ?? '0');
```

`Number(undefined)` → `NaN`, `Number('')` → `0`, `Number('abc')` → `NaN`, `Number('-1')` → `-1`. The value is then passed directly to Drizzle's `.offset(cursor)`. Drizzle passes this to the SQL driver verbatim. PostgreSQL rejects `OFFSET NaN` and `OFFSET -1` with a query error, which would result in an unhandled exception being thrown from the server component — a 500 error visible to any user who constructs a URL like `/transactions?cursor=-1`.

While this is not a data-exfiltration vulnerability (the query is already scoped by `user_id`), it is a reliable denial-of-service against any authenticated user's own transaction page.

**Fix:** Validate and clamp the cursor value:

```typescript
const cursor_raw = Number(cursor_param ?? '0');
const cursor = Number.isFinite(cursor_raw) && cursor_raw >= 0
  ? Math.floor(cursor_raw)
  : 0;
```

---

## Warnings

### WR-01: Race condition in disconnect flow — accounts soft-deleted before transaction history is preserved atomically

**File:** `src/app/api/pluggy/items/[id]/route.ts:64-93`

**Issue:** The disconnect sequence is: (1) call `PluggyService.deleteItem`, (2) soft-delete accounts, (3) insert consent revocation, (4) write audit log. Steps 2-4 are not wrapped in a database transaction. If the process crashes between step 1 and step 2, the Pluggy item is deleted on Pluggy's side but the local accounts remain `ACTIVE` — the user sees the connection as still active in the UI while syncs will fail indefinitely. Additionally, if multiple concurrent DELETE requests arrive for the same item (browser double-click, retry), the Pluggy API call in step 1 will succeed once and fail on the retry, but the local state mutation in step 2 may run twice or interleave with another request.

**Fix:** Wrap steps 2-4 in a Drizzle transaction to ensure atomicity:

```typescript
await getPluggyService().deleteItem({ user_id: session.userId, item_id_enc: it.pluggy_item_id_enc });

await db.transaction(async (tx) => {
  await tx.update(accounts)
    .set({ status: 'DELETED', updated_at: new Date() })
    .where(eq(accounts.pluggy_item_id, it.id));

  await tx.insert(user_consents).values({ ... });
});

await recordAudit({ ... }); // audit outside tx is acceptable (append-only)
```

---

### WR-02: `pluggySyncWorker` silently skips jobs when both `item_id` and `item_id_pluggy` are absent

**File:** `src/jobs/workers/pluggySyncWorker.ts:104-122`

**Issue:** The payload resolution block handles three cases: `item_id` present, `item_id_pluggy` present, or `user_id` present (logged as a warning and `continue`d). However if the payload contains none of these fields — which is a valid malformed payload — none of the branches execute. `item_row` remains `undefined`, the `if (!item_row)` guard fires, and the job is silently skipped with only a `sync_skipped` log. The job is not re-thrown, so pg-boss considers it successfully processed and does not retry it.

**Fix:** Add an explicit guard after the resolution block for the fully-empty payload case, and throw so pg-boss retries:

```typescript
if (!job.data.item_id && !job.data.item_id_pluggy && !job.data.user_id) {
  logger.error(
    { event: 'sync_skipped', reason: 'empty_payload', job_id: job.id },
    'sync job has no item_id, item_id_pluggy, or user_id — cannot resolve item',
  );
  // Do NOT throw — this job is unrecoverable (bad payload). Mark complete.
  continue;
}
```

Note: the existing `user_id`-only branch also silently `continue`s instead of throwing. That branch should also be evaluated — it logs a warn but does not re-throw, so a miscoded enqueue call would be silently lost.

---

### WR-03: `accounts_pluggy_account_id_unique` index is global — a Pluggy account ID collision across users would silently update another user's account record

**File:** `src/db/schema/accounts.ts:43-45`, `src/db/migrations/0001_02_pluggy_ingestion.sql:76`

**Issue:** The `accounts` upsert uses `onConflictDoUpdate({ target: accounts.pluggy_account_id })`. The `pluggy_account_id` UNIQUE index is not scoped per user:

```sql
CREATE UNIQUE INDEX "accounts_pluggy_account_id_unique" ON "accounts" USING btree ("pluggy_account_id");
```

Pluggy guarantees uniqueness of account IDs within its own system, but if a user connects the same bank account as another user (e.g., a joint account), both users share the same Pluggy `pluggy_account_id`. The upsert would silently update the existing row (belonging to user A) with data belonging to user B's sync, overwriting `user_id` if that were in the update set — or, more likely, simply updating balance/name on a row that does not belong to the triggering user.

This is an edge case for shared/joint accounts, but the IDOR contract (`user_id` duplicated on `accounts` for P26) is weakened by a global uniqueness constraint.

**Fix:** Change the unique index to be per `(user_id, pluggy_account_id)` and update the upsert target accordingly:

```sql
-- Migration
DROP INDEX "accounts_pluggy_account_id_unique";
CREATE UNIQUE INDEX "accounts_pluggy_account_id_unique"
  ON "accounts" USING btree ("user_id", "pluggy_account_id");
```

```typescript
// In pluggySyncWorker.ts upsert:
.onConflictDoUpdate({
  target: [accounts.user_id, accounts.pluggy_account_id],
  set: { name: sql.raw('excluded.name'), ... },
})
```

---

### WR-04: `console.error` in production client code leaks widget error messages

**File:** `src/app/connect/ConnectIsland.tsx:101`

**Issue:**

```typescript
function handleWidgetError(err: { message: string }) {
  console.error('[PluggyConnect] widget error:', err.message);
  ...
}
```

`console.error` in a Next.js client component is active in production builds. `err.message` from the Pluggy widget may contain internal Pluggy error codes, credential identifiers, or connector-specific messaging. This information appears in the browser's developer console where it could be extracted from a shared device or corporate device with monitoring software.

**Fix:** Remove or gate the `console.error` behind a development check:

```typescript
function handleWidgetError(err: { message: string }) {
  if (process.env.NODE_ENV === 'development') {
    console.error('[PluggyConnect] widget error:', err.message);
  }
  toast.error('Não foi possível conectar. Tente novamente ou entre em contato com o suporte.');
  setConnectToken(null);
}
```

---

### WR-05: `getActiveItemCount` in `connect/page.tsx` runs N+1 queries per item

**File:** `src/app/connect/page.tsx:36-65`

**Issue:** `getActiveItemCount` first fetches all `pluggy_items` rows for a user, then for each item fires two additional queries (one for ACTIVE accounts, one for all accounts). With N items, this is `1 + 2N` round-trips to the database, all executed serially inside a server component render. For a free-tier user this is at most 1-2 items (2-5 queries), but the pattern is fragile. More importantly, the logic is also slightly wrong: the function counts an item as "active" if it has no accounts yet OR has at least one ACTIVE account. This means an item in `LOGIN_ERROR` with no accounts is counted as active and will incorrectly trigger the paywall block.

**Fix:** Replace with a single aggregation query:

```typescript
async function getActiveItemCount(userId: string): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    SELECT count(DISTINCT pi.id)::int AS count
    FROM pluggy_items pi
    WHERE pi.user_id = ${userId}
      AND pi.status NOT IN ('LOGIN_ERROR', 'WAITING_USER_INPUT')
      AND (
        NOT EXISTS (SELECT 1 FROM accounts a WHERE a.pluggy_item_id = pi.id)
        OR EXISTS (SELECT 1 FROM accounts a WHERE a.pluggy_item_id = pi.id AND a.status = 'ACTIVE')
      )
  `);
  return (result as unknown as Array<{ count: number }>)[0]?.count ?? 0;
}
```

---

## Info

### IN-01: `encryptCPF` used as a generic AES-GCM helper for Pluggy item IDs — misleading naming

**File:** `src/app/api/pluggy/items/route.ts:26,54`

**Issue:**

```typescript
import { encryptCPF as encrypt, hashPluggyItemId } from '@/lib/crypto';
// ...
const item_enc = encrypt(body.pluggy_item_id);
```

The function is aliased to `encrypt` at the import site, which is fine, but the underlying export is named `encryptCPF` and lives in `crypto.ts` which is documented as a "CPF encryption" module. The comment on line 52 acknowledges this: `"encryptCPF is a generic AES-256-GCM helper — reused for pluggy_item_id"`. This creates a maintenance risk: a future developer reading `crypto.ts` may refactor `encryptCPF` without realizing it is also used for Pluggy item IDs.

**Fix:** Add a re-export alias in `crypto.ts` to make the reuse explicit:

```typescript
// In src/lib/crypto.ts — add after encryptCPF/decryptCPF:
/** Generic AES-256-GCM encrypt — same key and layout as encryptCPF. Use for any secret string. */
export const encryptSecret = encryptCPF;
export const decryptSecret = decryptCPF;
```

Then update `PluggyService.ts` and `pluggy/items/route.ts` to import the clearly named aliases.

---

### IN-02: `reAuthNotifierWorker` uses `return` instead of `continue` inside the `for` loop

**File:** `src/jobs/workers/reAuthNotifierWorker.ts:88`

**Issue:** When the item is not found, the worker calls `return` (line 88) instead of `continue`. In a batch of multiple jobs, `return` exits the entire function, skipping all subsequent jobs in the batch. This is inconsistent with the pattern used in other workers (e.g., `pluggySyncWorker.ts` uses `continue`). In practice `localConcurrency: 2` means pg-boss sends one job per call in most configurations, but the behavior is incorrect for batch sizes > 1.

The same early-`return` pattern appears on lines 100 (debounce) and 124 (user not found).

**Fix:** Replace `return` with `continue` in the item-not-found and debounce guards:

```typescript
if (!item) {
  logger.warn(...);
  continue; // not return
}
// ...
if (item.last_reauth_email_at && ...) {
  logger.info(...);
  continue; // not return
}
```

---

### IN-03: Free-tier history paywall only checks `posted_at >= month_start` — PENDING transactions just before cutoff could bypass

**File:** `src/app/transactions/page.tsx:102-103`

**Issue:** The paywall check compares `month_start < free_cutoff` where `free_cutoff = startOfMonth(subMonths(now, FREE_TIER_MONTHS - 1))`. This correctly blocks months entirely outside the 3-month window. However the subsequent transaction query uses `gte(transactions.posted_at, month_start)` and `lt(transactions.posted_at, month_end)`. A PENDING transaction originally posted in a free-cutoff month that gets re-dated by Pluggy on a later sync could theoretically appear in the allowed window. This is very low probability but the cutoff date math should be documented.

**Fix:** This is acceptable as-is for Phase 2. Add a comment to `transactions/page.tsx` near `free_cutoff` noting that PENDING transactions re-dated by Pluggy near the window boundary may appear inconsistently, and that Phase 3/4 server-side filtering should use `status = 'POSTED'` for aggregate views.

---

### IN-04: `pluggySyncWorker` does not update `pluggy_items.status` to `LOGIN_ERROR` or `WAITING_USER_INPUT` on Pluggy SDK auth failures

**File:** `src/jobs/workers/pluggySyncWorker.ts:360-386`

**Issue:** The catch block on sync failure updates `last_error_at` but does not flip `status` to `LOGIN_ERROR` when the SDK returns a 401/403 error code. The only way the item status is updated to `LOGIN_ERROR` or `WAITING_USER_INPUT` in Phase 2 is via the `item/error` and `item/waiting_user_input` webhook events (which go to `PLUGGY_REAUTH_NOTIFIER`). If webhooks are delayed or missed, the item stays in `UPDATING` or `UPDATED` state while the sync silently fails on every tick, and the re-auth banner never appears.

**Fix:** In the catch block, check `sdk_status` and flip item status accordingly:

```typescript
if (item_row) {
  const new_status =
    sdk_status === 403 || sdk_status === 401
      ? 'LOGIN_ERROR'
      : undefined;
  await db
    .update(pluggy_items)
    .set({
      last_error_at: new Date(),
      ...(new_status ? { status: new_status, updated_at: new Date() } : {}),
    })
    .where(eq(pluggy_items.id, item_row.id));
}
```

---

_Reviewed: 2026-05-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
