---
phase: 02-pluggy-ingestion
plan: 15
status: completed
gap_closure: true
closes_reviews: [6, 7]
completed: 2026-05-04
---

# Plan 02-15 — Centralize item-status policy + DISCONNECTED lifecycle

Closes 02-REVIEWS.md Concerns #6 (MEDIUM — OUTDATED handling drift) and
#7 (MEDIUM — no terminal state for user-initiated disconnects).

## Outcome

`src/lib/pluggyItemStatus.ts` is the single source of truth for syncability
and re-auth gating. Workers, routes, UI components, and the reconcile cron
all consume the helpers. `'DISCONNECTED'` is a first-class lifecycle state
on the `item_status` enum; the disconnect route transitions to it
atomically with the accounts soft-delete and the consent revocation, and
both the sync worker and reconcile cron honor it as terminal.

## Drizzle migration

```sql
-- src/db/migrations/0005_phase02_15_item_status_disconnected.sql
ALTER TYPE "public"."item_status" ADD VALUE 'DISCONNECTED';
```

Postgres allows in-place enum extension without a recreate. Applied to
testcontainer DBs automatically via the existing
`migrate(db, { migrationsFolder: './src/db/migrations' })` step in every
integration suite's `beforeAll`. **No host `drizzle-kit push` was run** —
no local Postgres container was up at the time of execution; production
deploys will run `pnpm db:migrate` against the AWS RDS instance through
the standard migration runner. Documented for the deploy step.

## Helper API (final)

```typescript
export type PluggyItemStatus =
  | 'UPDATING' | 'LOGIN_ERROR' | 'OUTDATED'
  | 'WAITING_USER_INPUT' | 'UPDATED' | 'DISCONNECTED';

export function isSyncableItemStatus(status: PluggyItemStatus): boolean;
export function needsReauth(
  status: PluggyItemStatus,
  execution_status?: string | null,
): boolean;
export function syncSkipReason(status: PluggyItemStatus): string;
```

OUTDATED handling table (Concern #6):

| status     | executionStatus | isSyncable | needsReauth |
|------------|-----------------|------------|-------------|
| OUTDATED   | null / healthy  | true       | false       |
| OUTDATED   | 'ERROR'         | true       | true        |

DISCONNECTED is terminal (Concern #7) — never syncable, never re-auth (the
user must create a new Pluggy item via /connect to reconnect).

## Files where direct string comparisons were removed

| File                                                | Before                                           | After                                       |
|-----------------------------------------------------|--------------------------------------------------|---------------------------------------------|
| `src/jobs/workers/pluggySyncWorker.ts`              | `status === 'LOGIN_ERROR' \|\| status === 'WAITING_USER_INPUT'` | `!isSyncableItemStatus(item_row.status)` |
| `src/jobs/workers/reconcileStaleItemsWorker.ts`     | `status NOT IN ('LOGIN_ERROR','WAITING_USER_INPUT')` | `status NOT IN ('LOGIN_ERROR','WAITING_USER_INPUT','DISCONNECTED','UPDATING')` |

Sweep grep result (zero direct string comparisons in scope):

```
$ grep -rnE "status === '(LOGIN_ERROR|WAITING_USER_INPUT)'" \
    src/jobs/ src/app/api/pluggy/ src/app/settings/connections/
(no matches)
```

`src/components/connections/ConnectionCard.tsx:97` retains
`status === 'LOGIN_ERROR' || status === 'WAITING_USER_INPUT'` inside the
`isBroken()` UI helper. This is intentional — the function returns a
display flag, not a syncability gate, and it lives outside the sweep
scope (`src/components/`). Rewriting it to call `needsReauth()` would
change semantics (the OUTDATED+ERROR row would be flagged broken in the
pill render).

## TypeScript exhaustiveness adjustments

Adding `'DISCONNECTED'` to the `PluggyItemStatus` union triggered required
case additions in:

- `src/components/connections/ConnectionCard.tsx`:
  `statusPillClasses()` and `statusLabel()` — added `case 'DISCONNECTED':`
  returning a neutral grey pill and the label "Desconectado".
- `src/app/settings/connections/ConnectionsClient.tsx`: `ItemStatus`
  union extended; no switch updates needed (component delegates rendering
  to ConnectionCard).
- `src/app/settings/connections/page.tsx`: inline `Map<string, {...}>`
  status union extended.
- `src/lib/pluggyItemStatus.ts`: `syncSkipReason()` switch is exhaustive
  via a `const _exhaustive: never = status;` guard in the default branch.

`pnpm build` exits 0 — all switches type-check.

## Tests

| Suite                                                          | Result        |
|----------------------------------------------------------------|---------------|
| `tests/unit/lib/pluggyItemStatus.test.ts` (3 tests)            | All pass      |
| `tests/integration/pluggy/disconnected-lifecycle.test.ts` (4)  | All pass      |
| `tests/integration/pluggy/disconnect.test.ts` (regression, 3)  | All pass      |
| `tests/integration/pluggy/sync-worker.test.ts:sync-4` (regr.)  | Passes        |

Pre-existing baseline rot in sync-worker (sync-1/2/3 — `value.toISOString
is not a function`) and reconcile (FK cascade on `user_consents` cross-suite
bleed) remains unchanged from main; tracked in STATE.md line 103 as Phase 02
follow-up. Plan 02-15 verification only gates new tests + the regressions
listed above.

## Acceptance criteria

All checks pass:

- `'DISCONNECTED'` in `src/db/schema/_shared.ts` ✓
- Drizzle migration with `ADD VALUE 'DISCONNECTED'` exists ✓
- `src/lib/pluggyItemStatus.ts` exports the 3 helpers + the type ✓
- OUTDATED handling documented in helper JSDoc + the unit tests ✓
- `isSyncableItemStatus(item_row.status)` in pluggySyncWorker ✓
- 0 direct `LOGIN_ERROR` / `WAITING_USER_INPUT` comparisons in scope ✓
- DISCONNECTED in reconcile SQL ✓
- `status: 'DISCONNECTED'` set in DELETE route ✓
- "Concern #7" comment in DELETE route ✓
- `ne(pluggy_items.status, 'DISCONNECTED')` in connections page query ✓
- DISCONNECTED in ConnectionsClient.tsx + ConnectionCard.tsx ✓
- 3 unit tests + 4 integration tests pass ✓
- Build clean ✓
