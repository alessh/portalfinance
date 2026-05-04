---
phase: 02-pluggy-ingestion
plan: 16
status: completed
gap_closure: true
closes_reviews: [8, 10]
completed: 2026-05-04
---

# Plan 02-16 — pg-boss singleton + vi.doMock conventions

Closes 02-REVIEWS.md Concerns #8 and #10 (both MEDIUM).

## pg-boss test outcome

**PASSED.** Empirical observations:

```
[pgboss-singleton-1] enqueued=5, ids_returned_non_null=5, completed=2, time_window=6549ms
[pgboss-singleton-2] completed=6, max_concurrent=6, witnesses=1,2,3,4,5,6
```

- `singleton-1` (same key, differing payloads, slow handler, batchSize=1):
  pg-boss returned 5 IDs (queue rows accepted) but only 2 completed in 6.5s.
  Conclusion: singletonKey gates **active+queued execution**, not enqueue.
  Differing payloads do NOT bypass dedup. ≤2 completions per the documented
  intent — the backlog stays minimal.
- `singleton-2` (different keys, concurrent batch, batchSize=6): all 6 jobs
  completed concurrently. Conclusion: dedup is per-key, not global —
  `singletonKey='user-A'` does not block `singletonKey='user-B'`.

Together these prove the production assumption is sound for pg-boss v12.
Forensic `console.log` in each test surfaces the actual counts so a future
pg-boss upgrade that breaks this assumption fires loudly in CI.

Failure-mode message in the assertion names the fallback:
```sql
SELECT pg_try_advisory_xact_lock(hashtext('pluggy.sync.' || user_id))
```
That follow-up plan would land separately if the dedup ever breaks.

## Final test conventions doc table of contents

- Singleton Testcontainer (plan 02-09 baseline)
- Mocking PluggyService in Route Tests
  - Canonical pattern (with `vi.resetModules` / `vi.unmock` /
    `vi.doMock` / dynamic `await import`)
  - Why each step
  - Anti-pattern (top-level static import + late `doMock`)
  - Empirical note (vitest 3.x re-applies `doMock` on subsequent dynamic
    imports even without `resetModules`; canonical pattern still recommended)
- pg-boss Singleton Semantics (Concern #8)
- Per-Suite Cleanup

## tests/setup.ts adjustments

None required. The existing `vi.mock('server-only')` and
`vi.mock('@/lib/serverOnly')` registrations from plan 02-10 do not interact
with the new tests; no `afterEach` cleanup hook was needed.

## Deviations

1. **`singletonHours: 0` dropped from test calls.** pg-boss v12 removed the
   option; production code at `/api/pluggy/items/route.ts` and the mutex-key
   pattern in plan 02-04 already use `singletonKey` alone. The test mirrors
   the production call shape rather than the plan's interfaces section.
2. **`mock-stability-2` flipped from negative to positive.** The plan
   hypothesized a stale-module-cache pitfall when `vi.resetModules()` is
   omitted between cases. Vitest 3.x actually re-applies `doMock` on every
   subsequent dynamic import, so the hypothesized pitfall does not reproduce.
   The test now asserts the observed behavior (second `doMock` honored) so
   a future vitest regression fires immediately. The canonical pattern in
   the doc still recommends `resetModules` for clarity and forward-compat.

## Test counts

| File | Tests |
|------|-------|
| `tests/integration/jobs/pg-boss-singleton.test.ts` | 2/2 GREEN |
| `tests/integration/pluggy/route-mock-stability.test.ts` | 2/2 GREEN |

## Commits

- `6155fda` review(02-16): empirical pg-boss singleton + vi.doMock conventions (codex #8, #10)
