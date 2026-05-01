---
slug: dsr-worker-undefined-value
status: root_cause_confirmed
trigger: "Pre-existing test failure: tests/integration/lgpd/dsr.test.ts — DSR acknowledge worker EXPORT + DELETE tests fail with `UNDEFINED_VALUE: Undefined values are not allowed` from postgres-js."
created: 2026-05-01
updated: 2026-05-01
goal: find_root_cause_only
scope: read_only
---

# Debug: dsrAcknowledgeWorker UNDEFINED_VALUE

## Symptoms

- **Tests:** `tests/integration/lgpd/dsr.test.ts > DSR acknowledge worker > sends acknowledgment email with protocol ID for EXPORT (15-day wording)` and `... 30-day wording for DELETE`.
- **Error:** `UNDEFINED_VALUE: Undefined values are not allowed` thrown by `postgres-js` `handleValue` (`postgres/src/types.js:83:20`).
- **Stack origin:** `dsrAcknowledgeWorker.ts:42` — the `db.select().from(dsr_requests).where(...)` call.
- **Driver args at failure:** `[ '<uuid>', undefined ]` — first param is a real `dsr_request_id`, second param is `undefined`.
- **Pre-existing:** confirmed via `git stash` + clean run on master. Not caused by recent commits in this session (login fix, env validation, instrumentation move).

## Root Cause

**Test bug, not worker bug.** The worker added an IDOR guard that filters by both `dsr_request_id` AND `user_id`:

```ts
// src/jobs/workers/dsrAcknowledgeWorker.ts:42–50
const [req] = await db
  .select()
  .from(dsr_requests)
  .where(
    and(
      eq(dsr_requests.id, job.data.dsr_request_id),
      eq(dsr_requests.user_id, job.data.user_id),  // <-- requires user_id
    ),
  );
```

The payload type `DsrAcknowledgePayload` declares `user_id: string` as **required** (line 32):

```ts
export interface DsrAcknowledgePayload {
  dsr_request_id: string;
  user_email: string;
  user_id: string; // required for IDOR guard (P26)
}
```

But both tests fake-construct the job with **only** `dsr_request_id` and `user_email` and cast through `as never` to bypass TypeScript:

```ts
// tests/integration/lgpd/dsr.test.ts:228–237 (EXPORT test)
const fake_jobs = [
  { data: { dsr_request_id: req_row!.id, user_email: email } },  // user_id missing
];
await dsrAcknowledgeWorker(fake_jobs as never);  // 'as never' silences the type error

// lines 268–270 (DELETE test) — same shape, same cast, same omission
```

At runtime `job.data.user_id` is `undefined`. Drizzle passes that to postgres-js as the second `eq(...)` argument, and postgres-js correctly rejects undefined values with `UNDEFINED_VALUE`.

## Why this slipped past type checking

`as never` widens the assertion target to the bottom type, satisfying any expected parameter shape. It is a code smell here — used precisely to dodge the missing-property error. The test was written before the IDOR guard was added (or the guard was added without retrofitting the test fixture).

## Why production is unaffected

The real producer at `src/app/api/privacy/export/route.ts` and `.../delete/route.ts` enqueues with the full payload including `user_id`, so prod jobs carry the field. Only the synthetic test payloads omit it.

## Recommended fix

Two-line test fix. Add `user_id: userId` to each fake-job payload:

```ts
// tests/integration/lgpd/dsr.test.ts:230–234 (EXPORT)
const fake_jobs = [
  {
    data: {
      dsr_request_id: req_row!.id,
      user_email: email,
      user_id: userId,    // <-- add
    },
  },
];

// tests/integration/lgpd/dsr.test.ts:268–270 (DELETE)
await dsrAcknowledgeWorker([
  { data: {
      dsr_request_id: req_row!.id,
      user_email: email,
      user_id: userId,    // <-- add
    },
  },
] as never);
```

Optional follow-up: drop the `as never` casts. With the field added, the cast is redundant — the literal object satisfies `Job<DsrAcknowledgePayload>[]` if `id` and a few other Job fields are filled in (or with a narrower `as Pick<Job<DsrAcknowledgePayload>, 'data'>[]` cast that only suppresses the unrelated Job metadata, not the payload shape).

## Files implicated

- `tests/integration/lgpd/dsr.test.ts:228–237` — EXPORT test fake (fix here)
- `tests/integration/lgpd/dsr.test.ts:268–270` — DELETE test fake (fix here)
- `src/jobs/workers/dsrAcknowledgeWorker.ts:32,48` — payload contract (no change needed)

## Resolution

Pending — root cause confirmed; fix proposed but not applied per read-only scope.
