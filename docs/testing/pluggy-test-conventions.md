# Pluggy Test Conventions

**Status:** ACTIVE
**Closes:** 02-REVIEWS.md Concerns #8 (pg-boss singleton) + #10 (vi.doMock stability)

## Singleton Testcontainer (plan 02-09 baseline)

- `pool: 'forks'`, `singleFork: true`, `isolate: false` for the integration project.
- One Postgres 16 container booted via `globalSetup`, shared across all suites.
- Module-level state (DB client, pg-boss handle) lives on `globalThis` to survive
  `vi.resetModules()`. See `tests/fixtures/db.ts` for the singleton handle pattern.

## Mocking PluggyService in Route Tests

**Canonical pattern (USE THIS):**

```typescript
beforeEach(() => {
  vi.resetModules();
  vi.unmock('@/services/PluggyService');
});

it('route under test', async () => {
  vi.doMock('@/services/PluggyService', () => ({
    getPluggyService: () => ({
      fetchAccounts: vi.fn().mockResolvedValue({ results: [...] }),
    }),
  }));
  // Dynamic import AFTER doMock — top-level static imports would have already
  // resolved with the real service.
  const { POST } = await import('@/app/api/pluggy/items/route');
  // exercise POST(...)
});
```

**Why:**

1. `vi.doMock` is hoisted-by-call (vs `vi.mock` which is hoisted-by-statement).
   `doMock` lets us swap mocks per-case.
2. Dynamic `await import(...)` AFTER `doMock` ensures the import sees the
   current mock — a top-level static import would be resolved before the
   `doMock` call.
3. `vi.resetModules()` in `beforeEach` flushes the module cache so each case
   starts with no prior mock applied.
4. `vi.unmock(...)` clears any leftover mock registration from a sibling suite
   (under `isolate: false`, mock registrations can leak between files).

**Anti-pattern (DO NOT DO):**

```typescript
import { POST } from '@/app/api/pluggy/items/route';   // resolves with the REAL service
beforeEach(() => {
  vi.doMock('@/services/PluggyService', () => ({ ... }));   // too late — POST is already imported
});
```

### Empirical note (vitest 3.x)

`mock-stability-2` in `tests/integration/pluggy/route-mock-stability.test.ts`
empirically verified that **vitest 3.x actually re-applies `doMock` on every
subsequent dynamic import even without `vi.resetModules()` between cases**.
The original concern (stale module cache returning the first mock) does NOT
reproduce. The canonical pattern above (with `resetModules` in `beforeEach`)
is still recommended for clarity and forward-compat: if a future vitest
upgrade reverts to module-cache-wins semantics, the canonical pattern keeps
working — the negative test fires immediately and surfaces the regression.

## pg-boss Singleton Semantics (Concern #8)

Plan 02-16's `tests/integration/jobs/pg-boss-singleton.test.ts` empirically
verifies that `singletonKey + singletonHours=0` produces ≤2 completions per
key when 5 jobs are enqueued sequentially with differing payloads:

```typescript
await boss.send(test_queue, { user_id, i }, { singletonKey: user_id, singletonHours: 0 });
```

If a future pg-boss upgrade breaks this assumption, the test FAILS with a
forensic message that names the fallback:

```sql
-- Advisory transactional lock at sync entry, keyed on user_id.
SELECT pg_try_advisory_xact_lock(hashtext('pluggy.sync.' || user_id));
```

Implementing the advisory lock is a follow-up plan, not part of 02-16 — the
trigger is the test failure.

## Per-Suite Cleanup

The shared testcontainer means table data persists across suites. Each
integration suite MUST `TRUNCATE` (or otherwise reset) the tables it touches
in `beforeEach` (or use a savepoint pattern). Plan 02-09's follow-up tracker
in `STATE.md` calls out the per-suite truncation gap; this conventions doc
is the authoritative reference once that gap closes.
