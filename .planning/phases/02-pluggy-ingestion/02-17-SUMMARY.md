---
phase: 02-pluggy-ingestion
plan: 17
status: completed
gap_closure: true
closes_reviews: [13]
partial_closes_reviews: [2]
completed: 2026-05-05
---

# Plan 02-17 — Real-sandbox e2e gate + screenshot smoke

Closes 02-REVIEWS.md **Concern #13 (LOW)** in full and **Concern #2 (HIGH)
partially**: the real-sandbox spec exists and is invocable on demand, but
the scheduled CI gate is **deferred** (project still deploys manually —
no GitHub Actions workflow shipped yet).

## Scope deviation from PLAN.md

The user paused the GitHub Actions piece. We executed everything else:

| PLAN.md item | Disposition |
|--------------|-------------|
| `.github/workflows/pluggy-sandbox-nightly.yml` | **deferred** — to be added when CI is re-enabled |
| Checkpoint: GitHub Secrets configured | **bypassed** (no workflow yet) |
| `tests/e2e/pluggy/sandbox-connect.spec.ts` | shipped |
| `tests/e2e/pluggy/screenshots-transactions.spec.ts` | shipped |
| `tests/e2e/pluggy/screenshots-connections.spec.ts` | shipped |
| `.planning/phases/02-pluggy-ingestion/02-SANDBOX-LAST-RUN.md` | shipped (manual update mode) |
| `docs/ops/pluggy-sandbox-gate.md` | shipped (adapted for manual local execution) |

The runbook's "Future Work — Re-enable CI" section captures the workflow
shape that should land later.

## Files added

- `tests/e2e/pluggy/sandbox-connect.spec.ts` — real-Pluggy-sandbox e2e
  gate; skipped unless `PLUGGY_SANDBOX_CLIENT_ID` + `PLUGGY_SANDBOX_CLIENT_SECRET`
  are set; asserts `/transactions` shows ≥1 row within 60 s of widget
  `onSuccess`.
- `tests/e2e/pluggy/screenshots-transactions.spec.ts` — 3 documented
  states (empty / loaded / paywall) of `/transactions`.
- `tests/e2e/pluggy/screenshots-connections.spec.ts` — 3 documented
  states (healthy / broken / cooldown) of `/settings/connections`.
- `tests/e2e/helpers/seedDb.ts` — first e2e helper file in the repo.
  Loads `.env.local`, mints a postgres-js client against the
  testcontainers Postgres that `scripts/run-e2e.ts` boots, and exposes
  `findUserIdByEmail`, `setUserSubscriptionTier`, `seedPluggyItem`,
  `seedAccount`, `seedTransaction`, `closeSeedPg`. Encryption (AES-256-GCM)
  + HMAC mirror `src/lib/crypto.ts` so the inserted rows match what
  PluggyService would produce.
- `docs/ops/pluggy-sandbox-gate.md` — manual-mode runbook (PowerShell
  + POSIX commands) with a clearly marked "Re-enable CI" follow-up.
- `.planning/phases/02-pluggy-ingestion/02-SANDBOX-LAST-RUN.md` —
  audit-trail stub the developer overwrites after each manual run.

## Auth pattern

Each spec inlines the canonical signup pattern from
`tests/e2e/auth.spec.ts` (lines 13-25). The helper file in
`tests/e2e/helpers/` is **only** for DB seeding — no auth helper exists
yet, and per the plan's interfaces note, that migration belongs to a
future phase that introduces `tests/e2e/helpers/auth.ts`.

## Quality gates

- `pnpm tsc --noEmit` — clean (exit 0).
- `pnpm lint` — pre-existing breakage (`next lint` deprecated in Next 16);
  not introduced by this plan.
- Acceptance-criteria greps from PLAN.md — all match (verified inline).

## Concerns left open

- **#2 (HIGH)** still partially open: the spec exists locally but the
  scheduled gate is deferred. To fully close, add the GitHub Actions
  job per the runbook's "Future Work" section once automated deploys
  resume.

## Follow-ups

- Run `pnpm test:e2e -- pluggy/sandbox-connect.spec.ts` once with real
  sandbox credentials to verify the spec works end-to-end against
  Pluggy's current widget DOM, then overwrite `02-SANDBOX-LAST-RUN.md`
  with the timestamp + observed metrics.
- Re-introduce the nightly CI workflow when manual deploys are replaced
  by automation.
