# Pluggy Sandbox Real-Connect Gate (Ops Runbook)

**Spec:** `tests/e2e/pluggy/sandbox-connect.spec.ts`
**Audit trail:** `.planning/phases/02-pluggy-ingestion/02-SANDBOX-LAST-RUN.md`
**Closes (partially):** `02-REVIEWS.md` Concern #2

## Purpose

Roadmap success criterion #1 says:

> User opens `/connect`, completes Pluggy sandbox bank, sees accounts and
> transactions on `/transactions` within 60 seconds.

The mocked E2E suite (Phase 2 plan 02-06) only proves UI navigation. The
spec referenced above proves the real Pluggy sandbox + `pg-boss` worker
round-trip meets the 60-second budget end-to-end.

## Current Mode: Manual

Deploys are still manual (no GitHub Actions yet). The spec is gated by
two env vars and is **skipped** when they are absent so day-to-day
`pnpm test:e2e` runs do not burn Pluggy sandbox quota.

When CI is re-enabled, wire this same spec into a nightly job; the spec
itself is CI-ready (skip-on-missing-secrets guard, deterministic
selectors, 60-second hard assertion).

## Required Env Vars

| Variable | Source |
|----------|--------|
| `PLUGGY_SANDBOX_CLIENT_ID` | Pluggy Dashboard → Applications → Sandbox → API Credentials |
| `PLUGGY_SANDBOX_CLIENT_SECRET` | same |

These are **distinct** from production credentials. Rotate quarterly per
the security policy that lands in Phase 6.

`scripts/run-e2e.ts` already plumbs both vars into `.env.local` when
present (falling back to `stub-client-id-for-e2e` / `stub-client-secret-for-e2e`
otherwise) — see `scripts/run-e2e.ts` lines 60-61.

## How to Run Manually

From a shell with sandbox credentials available:

```pwsh
$env:PLUGGY_SANDBOX_CLIENT_ID = "<from Pluggy dashboard>"
$env:PLUGGY_SANDBOX_CLIENT_SECRET = "<from Pluggy dashboard>"
pnpm test:e2e -- pluggy/sandbox-connect.spec.ts
```

POSIX equivalent:

```bash
PLUGGY_SANDBOX_CLIENT_ID=... PLUGGY_SANDBOX_CLIENT_SECRET=... \
  pnpm test:e2e -- pluggy/sandbox-connect.spec.ts
```

On success, overwrite `.planning/phases/02-pluggy-ingestion/02-SANDBOX-LAST-RUN.md`
with the run timestamp + observed `[sandbox-connect] observed_latency_ms=...
tx_count=...` line that the spec prints to stdout.

## Sandbox Item Expiry

Pluggy sandbox items auto-expire after 30 days (CONTEXT.md D-48). The
spec creates a fresh item each run via `react-pluggy-connect`, so
expiry is not a concern for this gate. If a future spec ever pre-seeds
a sandbox item, add a `beforeAll` retry-on-`INVALID_PARAMETER` guard.

## Failure Triage

1. Re-run once — Pluggy widget loads can be transient over flaky networks.
2. Open the Playwright HTML report (`playwright-report/index.html`) and
   inspect the trace to see which step exceeded the budget:
   - **Pluggy widget load slow** → likely transient; retry.
   - **Worker not picking up sync within 60 s** → check worker logs and
     suspect `pg-boss` queue starvation.
   - **/transactions empty after sync** → suspect TX-01 dedup or
     upsert regression in `pluggySyncWorker`.
3. If the failure persists across two runs, escalate to Phase 6 ops
   triage.

## Companion Specs

- `tests/e2e/pluggy/screenshots-transactions.spec.ts` — visual smoke
  for the three documented `/transactions` states (empty / loaded /
  paywall) (Concern #13).
- `tests/e2e/pluggy/screenshots-connections.spec.ts` — visual smoke
  for the three documented `/settings/connections` states (healthy /
  broken / cooldown) (Concern #13).

These run with the regular `pnpm test:e2e` invocation against the
mocked Postgres testcontainer (no sandbox credentials needed) and are
intended to produce a baseline in `test-results/screenshots/` for
future visual diffing.

## Future Work — Re-enable CI

When automated deploys come back online, add a nightly GitHub Actions
job that:

1. Sets `PLUGGY_SANDBOX_CLIENT_ID` + `PLUGGY_SANDBOX_CLIENT_SECRET`
   from repo secrets.
2. Runs `pnpm test:e2e -- pluggy/sandbox-connect.spec.ts`.
3. On success, commits the audit-trail file with the run metadata.
4. On failure, uploads the `playwright-report/` artifact.

The spec is already shaped to fit that workflow with no further
changes.
