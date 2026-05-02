---
phase: 02-pluggy-ingestion
plan: 03
subsystem: connect-flow
tags: [pluggy, connect, consent, api-routes, polling, paywall]
requirements: [LGPD-02, CONN-01]

dependency_graph:
  requires:
    - 02-01  # schema: pluggy_items, accounts, user_consents, queues
    - 02-02  # PluggyService.createConnectToken
  provides:
    - connect-flow-end-to-end  # /connect → consent → widget → /connect/success → /transactions
    - api-connect-init         # POST /api/connect/init
    - api-pluggy-items         # POST /api/pluggy/items
    - api-sync-status          # GET /api/sync-status
    - sync-progress-card       # SyncProgressCard polling component
    - paywall-stub-card        # PaywallStubCard (reusable in plan 02-06)
  affects:
    - plan-02-06  # PaywallStubCard used in /transactions older-month gate

tech_stack:
  added:
    - "@tanstack/react-query@^5.100.8"  # polling via useQuery refetchInterval
  patterns:
    - "S1: IDOR Guard — reconnect path filters pluggy_items by user_id, returns 404 not 403"
    - "S5: pg-boss singletonKey=userId deduplicates in-flight PLUGGY_SYNC jobs"
    - "S6: AES-256-GCM via encryptCPF helper reused for pluggy_item_id_enc"
    - "D-08: append-only user_consents — PLUGGY_CONNECT_PENDING (pre-widget) + PLUGGY_CONNECTOR:{id} (post-widget)"

key_files:
  created:
    - src/components/connect/SyncProgressCard.tsx
    - src/app/connect/success/page.tsx
    - src/app/connect/ConnectIsland.tsx
    - src/components/billing/PaywallStubCard.tsx
    - src/components/connect/PluggyConnectWidget.tsx
    - src/app/connect/page.tsx
    - src/app/api/connect/init/route.ts
    - src/app/api/pluggy/items/route.ts
    - src/app/api/sync-status/route.ts
    - tests/integration/pluggy/connect-token.test.ts
    - tests/integration/pluggy/connect-init.test.ts
    - tests/unit/components/SyncProgressCard.test.tsx
  modified:
    - src/components/consent/ConsentScreen.tsx  # extended with hasCpf, ctaLabel, cpfError, cancelHref props
    - src/lib/cpf.ts                            # added encryptAndHashCPF convenience wrapper
    - next.config.ts                             # NEXT_PUBLIC_PLUGGY_ENV env passthrough

decisions:
  - "Use TanStack Query useQuery with refetchInterval=2000 for /api/sync-status polling (avoids raw setInterval state complexity)"
  - "PaywallStubCard links to /settings/billing which is a future phase stub — intentional"
  - "institution_name set to Conta {connector_id} in ConnectIsland since widget callback lacks connector name; sync worker will update"
  - "pg-boss v12 uses singletonKey only — singletonHours field removed from pg-boss 12 SendOptions"

metrics:
  duration_minutes: 75
  completed_date: "2026-05-02"
  tasks_completed: 2
  tasks_total: 2
  files_created: 12
  files_modified: 3
---

# Phase 02 Plan 03: Connect Flow Summary

**One-liner:** End-to-end Pluggy bank-connection UI with LGPD consent, encrypted item storage, async sync enqueue, and TanStack Query polling card with 60s timeout redirect.

## What Was Built

### Task 1 — ConsentScreen extension + PluggyConnectWidget + PaywallStubCard + /connect page (commit `e5cf7c8`)

- **ConsentScreen extended** with `hasCpf`, `ctaLabel`, `cpfError`, `cancelHref`, `collapsibleDetails` props. Inline CPF field renders when `!hasCpf && scope === 'PLUGGY_CONNECT_PENDING'`. Client-side `CPFSchema.safeParse` validates before submitting. `onSubmit` made optional for backward-compat with Phase 1 `onConsent` callers.
- **PluggyConnectWidget** wraps `react-pluggy-connect@2.12` with full-screen overlay. SDK `onSuccess` shape is `(data: { item: Item })` not flat `(item)` — fixed during implementation.
- **PaywallStubCard** supports two contexts: `transactions-history` (plan 02-06) and `second-item-block` (plan 02-03, D-49).
- **ConnectIsland** client island: submit consent → `POST /api/connect/init` → open widget → `POST /api/pluggy/items` → `router.push('/connect/success')`.
- **/connect page** server component: paywall stub for free tier with ≥1 active item; reconnect flow; default consent flow.
- **src/lib/cpf.ts** extended with `encryptAndHashCPF()` convenience wrapper (was missing, Rule 2 add).

### Task 2 — API routes + SyncProgressCard + integration tests (commit `4edd88f`)

- **POST /api/connect/init**: CPF validation → PLUGGY_CONNECT_PENDING consent row → optional CPF encrypt+hash → Pluggy token via PluggyService. Invalid CPF → 400 INVALID_CPF with zero DB writes and zero PluggyService calls (D-06).
- **POST /api/pluggy/items**: encrypt+hash pluggy_item_id (AES-256-GCM) → insert pluggy_items → PLUGGY_CONNECTOR:{id} consent → enqueue PLUGGY_SYNC with singletonKey=userId → audit log → 202 Accepted.
- **GET /api/sync-status**: phase detection from accounts/transactions counts; requireSession gates before any DB read (T-02-F).
- **SyncProgressCard**: TanStack Query `refetchInterval: 2000`; `setInterval(1000ms)` for elapsed_ms tracking; `useEffect` redirects on `phase === 'completed'` or `elapsed_ms >= 60_000`.
- **/connect/success page**: server shell with requireSession + renders SyncProgressCard.
- **Integration tests**: `connect-token.test.ts` (4 tests: invalid CPF, valid CPF + consent row, CPF already set, no session) + `connect-init.test.ts` (5 tests: pluggy-items-1..3, sync-status-1..2). Uses testcontainers PostgreSQL + Drizzle migrations + vi.doMock for PluggyService.
- **Unit tests**: `SyncProgressCard.test.tsx` (3 tests: refetchInterval=2000, completed redirect, 60s timeout redirect). All pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] `encryptAndHashCPF` not in `src/lib/cpf.ts`**
- **Found during:** Task 2 (route import failed — function referenced in plan but not yet implemented)
- **Issue:** Plan referenced `encryptAndHashCPF` from `@/lib/cpf` but the function didn't exist
- **Fix:** Added convenience wrapper calling `encryptCPF(cpf)` + `hashCPF(cpf)` from `@/lib/crypto`
- **Files modified:** `src/lib/cpf.ts`
- **Commit:** `e5cf7c8`

**2. [Rule 1 - Bug] react-pluggy-connect@2.12 onSuccess callback shape mismatch**
- **Found during:** Task 1 TypeScript check
- **Issue:** Plan spec wrote `onSuccess={(item) => ...}` but SDK type is `(data: { item: Item }) => void`
- **Fix:** Changed to `onSuccess={(data) => props.onSuccess(data.item.id, data.item.connector.id)}`
- **Files modified:** `src/components/connect/PluggyConnectWidget.tsx`
- **Commit:** `e5cf7c8`

**3. [Rule 1 - Bug] Plan referenced `consent_version_hash` but actual schema column is `consent_version`**
- **Found during:** Task 2 TypeScript check
- **Issue:** Plan spec used `consent_version_hash` in user_consents insert; schema column is `consent_version`
- **Fix:** Used `consent_version` in both API route handlers
- **Files modified:** `src/app/api/connect/init/route.ts`, `src/app/api/pluggy/items/route.ts`
- **Commit:** `4edd88f`

**4. [Rule 1 - Bug] `singletonHours` not in pg-boss v12 SendOptions**
- **Found during:** Task 2 TypeScript check — `Property 'singletonHours' does not exist on type 'SendOptions'`
- **Issue:** Plan specified `{ singletonKey: session.userId, singletonHours: 0 }` but pg-boss v12 removed `singletonHours`
- **Fix:** Removed `singletonHours: 0`; `singletonKey` alone deduplicates in-flight jobs
- **Files modified:** `src/app/api/pluggy/items/route.ts`
- **Commit:** `4edd88f`

**5. [Rule 3 - Blocking] `@tanstack/react-query` not installed**
- **Found during:** Task 2 TypeScript check — `Cannot find module '@tanstack/react-query'`
- **Issue:** SyncProgressCard imports TanStack Query v5 but it wasn't in package.json
- **Fix:** `pnpm add @tanstack/react-query@^5.100.8` (STACK.md planned this package at `^5`)
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Commit:** `4edd88f`

**6. [Rule 1 - Bug] `process.env.NODE_ENV` is read-only in TypeScript**
- **Found during:** Task 2 TypeScript check — `Cannot assign to 'NODE_ENV' because it is a read-only property`
- **Issue:** Integration tests tried to set `process.env.NODE_ENV = 'test'` which is already `'test'` in vitest
- **Fix:** Removed the NODE_ENV assignment; added comment explaining vitest already sets it
- **Files modified:** `tests/integration/pluggy/connect-token.test.ts`, `tests/integration/pluggy/connect-init.test.ts`
- **Commit:** `4edd88f`

**7. [Rule 1 - Bug] SyncProgressCard sync-progress-3 unit test timed out**
- **Found during:** Task 2 unit test run — test used `vi.advanceTimersByTime(60_000)` + `setTimeout(resolve, 0)` which didn't flush React state updates
- **Fix:** Changed to `await vi.advanceTimersByTimeAsync(60_000)` which flushes promises between timer ticks; added `15_000ms` timeout override
- **Files modified:** `tests/unit/components/SyncProgressCard.test.tsx`
- **Commit:** `4edd88f`

**8. [Rule 1 - Bug] `refetchInterval: POLL_INTERVAL_MS` didn't match plan grep pattern `refetchInterval.*2000`**
- **Found during:** Task 2 acceptance criteria check
- **Issue:** Plan acceptance criteria requires `grep -E "refetchInterval.*2000"` to match; constant reference doesn't satisfy the pattern
- **Fix:** Changed to `refetchInterval: 2000` inline and removed unused `POLL_INTERVAL_MS` constant
- **Files modified:** `src/components/connect/SyncProgressCard.tsx`
- **Commit:** `4edd88f`

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `institution_name: \`Conta ${connector_id}\`` | `src/app/connect/ConnectIsland.tsx` | 78 | Widget onSuccess callback doesn't provide connector name; sync worker updates institution_name from Pluggy item response in plan 02-04 |
| PaywallStubCard → `/settings/billing` | `src/components/billing/PaywallStubCard.tsx` | 67 | Billing settings page is plan 05-xx; link is intentionally a future stub |
| `<details>` legal copy TODO | `src/components/consent/ConsentScreen.tsx` | (collapsibleDetails) | Legal citation text left for legal review; renders "TODO(plan-02-03): insert LGPD legal citations" |

The `institution_name` stub does NOT prevent the connect flow from working — the row is inserted with a placeholder and updated by the sync worker. Users never see this field on the connect success screen.

## Threat Flags

No new threat surfaces beyond the plan's `<threat_model>` were introduced. All T-02-A through T-02-G mitigations are implemented:
- T-02-A: pluggy_item_id encrypted at write via `encryptCPF` helper (AES-256-GCM)
- T-02-B: user_consents uses insert-only; no UPDATE statements in any route
- T-02-C: CPF validated before any DB write; zero writes on invalid CPF
- T-02-D: free tier paywall checked server-side before token issuance
- T-02-E: reconnect path filters by user_id, returns 404 not 403
- T-02-F: requireSession() called before any DB read in /api/sync-status
- T-02-G: UNIQUE(user_id, pluggy_item_id_hash) makes replay idempotent (409)

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| Unit: SyncProgressCard | 3/3 | PASS |
| Integration: connect-token | 4/4 | PENDING (Docker required — not available in worktree) |
| Integration: connect-init | 5/5 | PENDING (Docker required — not available in worktree) |
| TypeScript | 0 errors | PASS |

Integration tests require Docker (testcontainers). The test code is complete and verified by TypeScript compilation. They should be run in the CI environment with Docker available.

## Self-Check: PASSED

**Files exist:**
- src/app/api/connect/init/route.ts: FOUND
- src/app/api/pluggy/items/route.ts: FOUND
- src/app/api/sync-status/route.ts: FOUND
- src/app/connect/success/page.tsx: FOUND
- src/components/connect/SyncProgressCard.tsx: FOUND
- src/components/billing/PaywallStubCard.tsx: FOUND
- tests/unit/components/SyncProgressCard.test.tsx: FOUND
- tests/integration/pluggy/connect-token.test.ts: FOUND
- tests/integration/pluggy/connect-init.test.ts: FOUND

**Commits exist:**
- e5cf7c8: Task 1 (ConsentScreen + PluggyConnectWidget + PaywallStubCard + /connect page)
- 4edd88f: Task 2 (API routes + SyncProgressCard + integration tests)
