---
phase: 02-pluggy-ingestion
plan: 06
subsystem: transactions-ui, connections-ui, sync-api, disconnect-api
tags: [pluggy, ui, transactions, connections, cooldown, disconnect, e2e, idor, lgpd]
dependency_graph:
  requires: [02-01, 02-02, 02-03, 02-04, 02-05]
  provides:
    - /transactions SSR page with date-grouped paginated list + paywall gate
    - /settings/connections SSR page with ConnectionCard per item
    - POST /api/pluggy/items/:id/sync with cooldown + free-tier enforcement
    - DELETE /api/pluggy/items/:id with Pluggy-first atomicity + LGPD revocation
    - DisconnectConfirmModal with typed DISCONNECT phrase
    - AuthenticatedShell wrapping authenticated routes with BannerStack
  affects: [pluggy-items, accounts, user_consents, audit_log]
tech_stack:
  added:
    - shadcn/ui select, tooltip, collapsible, progress components
    - .npmrc node-linker=hoisted (Turbopack Windows pnpm symlink fix)
  patterns:
    - Server-side paywall gate (T-02-D): transactions never serialized to client when blocked
    - IDOR guard: every query AND user_id = session.userId, returns 404 on miss (P26)
    - TDD RED/GREEN: 9 integration tests written before routes
    - pg-boss singletonKey for per-user sync deduplication (D-41)
    - Append-only LGPD consent revocation (LGPD-02)
    - Pluggy-first atomicity: deleteItem before local mutation (T-02-E)
key_files:
  created:
    - src/components/layout/AuthenticatedShell.tsx
    - src/components/transactions/TransactionList.tsx
    - src/components/transactions/EmptyTransactions.tsx
    - src/components/connections/ConnectionCard.tsx
    - src/components/connections/DisconnectConfirmModal.tsx
    - src/app/transactions/page.tsx
    - src/app/transactions/FilterRow.tsx
    - src/app/settings/connections/page.tsx
    - src/app/settings/connections/ConnectionsClient.tsx
    - src/app/api/pluggy/items/[id]/sync/route.ts
    - src/app/api/pluggy/items/[id]/route.ts
    - src/components/ui/select.tsx
    - src/components/ui/tooltip.tsx
    - src/components/ui/collapsible.tsx
    - src/components/ui/progress.tsx
    - tests/integration/pluggy/cooldown.test.ts
    - tests/integration/pluggy/disconnect.test.ts
    - tests/integration/pluggy/free-tier.test.ts
    - tests/e2e/pluggy/connect-flow.spec.ts
    - .npmrc
  modified:
    - next.config.ts (turbopack.root POSIX path fix for Windows)
    - package.json (shadcn component additions via pnpm)
    - pnpm-lock.yaml
decisions:
  - D-dev-01: FilterRow is a 'use client' component with requestSubmit() so selects auto-submit without a visible submit button (noscript fallback included)
  - D-dev-02: TransactionList pagination is SSR-first — hasMore passed as false, Link rendered in page.tsx for Carregar mais
  - D-dev-03: E2E test uses page.route() mocks for all Pluggy endpoints; no real sandbox credentials required (opt-in via PLUGGY_SANDBOX_CLIENT_ID env)
  - D-dev-04: Worktree Turbopack Windows bug fixed via .npmrc node-linker=hoisted (flat node_modules instead of pnpm symlinks)
metrics:
  duration: 2.5h (cross-session continuation)
  tasks_completed: 2
  files_created: 19
  files_modified: 3
  completed_date: "2026-05-02"
---

# Phase 02 Plan 06: User-Visible Read + Management Surfaces Summary

SSR transactions list + connections management UI + manual sync + disconnect API routes with cooldown enforcement, LGPD revocation, and full IDOR protection.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | SSR pages + AuthenticatedShell + components | 861587f | 17 files created/modified |
| 2 (RED) | Integration tests for sync + disconnect API | 7290334 | 4 test files |
| 2 (GREEN) | Sync + disconnect API routes implementation | fbb0bba | 2 route files |

## What Was Built

### Task 1 — UI Components + SSR Pages

**AuthenticatedShell** (`src/components/layout/AuthenticatedShell.tsx`):
- Server async component wrapping every authenticated page
- Fetches broken Pluggy items (LOGIN_ERROR / WAITING_USER_INPUT) via IDOR-safe query
- Mounts BannerStack with ReAuthBanner (priority=10) + EmailVerificationNagBanner (priority=5)
- Minimal sticky TopNav at top-12 z-30 (Phase 4 full nav TBD)

**TransactionList** (`src/components/transactions/TransactionList.tsx`):
- Date-grouped list with sticky h-8 headers: 'Hoje' / 'Ontem' / '{d MMM}' (ptBR)
- tabular-nums amounts: CREDIT = emerald-700, DEBIT = foreground
- Chips: Pendente (amber-100/700), Transferência (muted), Pagamento de fatura (muted)
- Deterministic account color dot via hashColor()
- "Carregar mais" button (SSR pagination via Link in page.tsx)

**EmptyTransactions** (`src/components/transactions/EmptyTransactions.tsx`):
- EmptyNoItems: Landmark icon + "Conectar meu banco" CTA
- EmptySyncing: animated Loader2 + "Buscando suas transações..."
- EmptyNoTransactionsInMonth: CalendarOff icon + "Sem transações em {month_label}"

**ConnectionCard** (`src/components/connections/ConnectionCard.tsx`):
- Status pill: UPDATED=emerald, UPDATING=blue pulsing dot, LOGIN_ERROR=red, OUTDATED/WAITING=amber
- Last-synced relative time with shadcn Tooltip showing absolute timestamp + cooldown copy
- Collapsible sub-account list (shadcn Collapsible) with BRL-formatted balance
- Live cooldown countdown via useEffect/setInterval(60s)
- Action buttons: Reconectar (broken) / Aguarde N min (cooling) / Sincronizar agora (ready)
- Desconectar always visible with destructive border/text classes

**DisconnectConfirmModal** (`src/components/connections/DisconnectConfirmModal.tsx`):
- shadcn Dialog with typed-confirmation pattern (T-02-F, UI-SPEC § 3.8)
- Requires verbatim 'DISCONNECT' phrase before confirm enables
- Cancel button label: 'Manter conexão' (NOT 'Cancelar')
- aria-disabled alongside HTML disabled for screen reader compatibility

**/transactions page** (`src/app/transactions/page.tsx`):
- requireSession() gate → redirect /login on failure
- Free-tier paywall: `month_start < free_cutoff` replaces tx data with PaywallStubCard (T-02-D)
- FilterRow client component: month + account selects with requestSubmit()
- `.limit(51)` lookahead pagination (50/page + 1 for hasMore detection, D-22)
- Three empty states based on has_items + is_syncing + tx count

**/settings/connections page** (`src/app/settings/connections/page.tsx`):
- LEFT JOIN pluggy_items + accounts (status='ACTIVE')
- Groups into Map by item ID, computes cooldown_remaining_seconds server-side
- Delegates interactions to ConnectionsClient (sync + disconnect)

### Task 2 — API Routes (TDD)

**POST /api/pluggy/items/:id/sync** (`src/app/api/pluggy/items/[id]/sync/route.ts`):
- COOLDOWN_MS = 30 * 60 * 1000 (D-28, CONN-06)
- Free-tier → 403 PAYWALL + upgrade_url=/settings/billing (D-29, T-02-C)
- Within cooldown → 429 COOLDOWN_ACTIVE + retry_after_seconds + Retry-After header
- Past cooldown → enqueue PLUGGY_SYNC with trigger=manual, singletonKey=session.userId
- Writes audit_log action=manual_sync_triggered, cooldown_bypassed=false (D-13)
- IDOR via innerJoin + user_id filter; 404 on miss (P26)

**DELETE /api/pluggy/items/:id** (`src/app/api/pluggy/items/[id]/route.ts`):
- Calls PluggyService.deleteItem FIRST → 502 on failure, no local mutation (T-02-E)
- Soft-deletes accounts → status='DELETED' (history preserved per D-04)
- Appends user_consents REVOKED row (LGPD-02)
- Writes audit_log action=item_disconnected (D-13)
- pluggy_items row NOT deleted (history preserved per D-04)
- IDOR: 404 on user_id miss (P26)

## Integration Test Results

All 9 new integration tests pass:

| Test | File | Result |
|------|------|--------|
| cooldown-1: within 30-min → 429 | cooldown.test.ts | PASS |
| cooldown-2: past cooldown → 202 + enqueued + audit | cooldown.test.ts | PASS |
| cooldown-3: free-tier → 403 PAYWALL | cooldown.test.ts | PASS |
| cooldown-4: IDOR → 404 (P26) | cooldown.test.ts | PASS |
| disconnect-1: happy path + cascade + revocation + audit | disconnect.test.ts | PASS |
| disconnect-2: Pluggy failure → 502, state unchanged | disconnect.test.ts | PASS |
| disconnect-3: IDOR → 404 (P26) | disconnect.test.ts | PASS |
| free-tier-1: paywall check via sync endpoint | free-tier.test.ts | PASS |
| free-tier-2: free-tier sync → 403 PAYWALL | free-tier.test.ts | PASS |

### E2E Test

`tests/e2e/pluggy/connect-flow.spec.ts` — mocked happy path:
- All Pluggy API calls mocked via page.route() intercepts
- No real sandbox credentials required
- Mock flow: /signup → /connect → mocked connect-token → mocked /api/pluggy/items → /connect/success → mocked sync-status=completed → /transactions
- E2E test runs against the full Next.js app with testcontainers Postgres
- Real sandbox opt-in: set PLUGGY_SANDBOX_CLIENT_ID/SECRET env in CI for live flow

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FilterRow extracted as 'use client' component**
- **Found during:** Task 1 implementation
- **Issue:** Native HTML `onChange="this.form.submit()"` string attribute is invalid React JSX (TS error TS2322)
- **Fix:** Extracted FilterRow.tsx as 'use client' component using `useRef<HTMLFormElement>` + `requestSubmit()`
- **Files modified:** src/app/transactions/FilterRow.tsx (new), src/app/transactions/page.tsx
- **Commit:** 861587f

**2. [Rule 1 - Bug] Account type 'BANK' not valid enum**
- **Found during:** Task 2 typecheck
- **Issue:** disconnect.test.ts used `type: 'BANK'` but account_type_enum only allows CHECKING/SAVINGS/CREDIT_CARD/LOAN/INVESTMENT/OTHER
- **Fix:** Changed to `type: 'CHECKING'`
- **Files modified:** tests/integration/pluggy/disconnect.test.ts
- **Commit:** fbb0bba

**3. [Rule 1 - Bug] getConsentVersionHash does not exist**
- **Found during:** Task 2 implementation
- **Issue:** Plan code snippet referenced `getConsentVersionHash` but the actual export is `getPluggyConsentVersionHash`; column name is `consent_version` not `consent_version_hash`
- **Fix:** Used correct function name and column name
- **Files modified:** src/app/api/pluggy/items/[id]/route.ts
- **Commit:** fbb0bba

**4. [Rule 2 - Missing critical functionality] Turbopack pnpm symlink fix**
- **Found during:** Task 1 build verification
- **Issue:** Turbopack on Windows cannot follow pnpm virtual store symlinks when multiple Radix versions coexist; shadcn shadcn add introduced @radix-ui/react-primitive@2.1.4 alongside @2.1.3
- **Fix:** Added .npmrc with `node-linker=hoisted` to use flat node_modules (real directories)
- **Files modified:** .npmrc (new)
- **Commit:** 861587f

**5. [Deviation] SSR-first pagination for /transactions**
- **Reason:** TransactionList has `onLoadMore` and `isLoadingMore` props for client-side pagination, but since the page is a server component, "Carregar mais" uses a server-rendered Link instead. `hasMore={false}` passed to TransactionList (no duplicate button); the page renders its own pagination Link.
- **Impact:** No JavaScript required to paginate — works with noscript; client-side SPA pagination deferred to Phase 4.

## TDD Gate Compliance

- RED gate: commit `7290334` — `test(02-06): add failing integration tests for cooldown, disconnect, free-tier (TDD RED)`
- GREEN gate: commit `fbb0bba` — `feature(02-06): implement sync + disconnect API routes (TDD GREEN)`
- REFACTOR: No refactoring needed — routes are clean and minimal.

## Manual Smoke Checklist (for /gsd-verify-work)

- [ ] As paid user on /settings/connections: click "Sincronizar agora" → toast "Sincronização iniciada"; button momentarily shows busy state
- [ ] As paid user (just synced): click "Sincronizar agora" again → toast with minutes remaining
- [ ] As free user on /settings/connections: click "Sincronizar agora" → PaywallStubCard modal opens
- [ ] Disconnect flow: click "Desconectar" → modal opens; type "disconnect" (lowercase) → confirm stays disabled; type "DISCONNECT" → confirm enables; click → toast "Conexão encerrada"; page reloads
- [ ] /transactions: month picker changes → page reloads with filtered data
- [ ] /transactions as free user: select month > 3 months ago → PaywallStubCard overlay
- [ ] ReAuthBanner appears when a pluggy_items row has status=LOGIN_ERROR
- [ ] EmailVerificationNagBanner appears when email_verified_at is null

## Threat Model Coverage

All STRIDE threats from plan threat register are mitigated:

| Threat | Mitigation | Test |
|--------|------------|------|
| T-02-A: IDOR on sync/delete routes | user_id filter + 404 | cooldown-4, disconnect-3 |
| T-02-B: DoS via cooldown bypass | server-side last_synced_at check | cooldown-1 |
| T-02-C: Free-tier paywall bypass | tier check at API layer | cooldown-3, free-tier-2 |
| T-02-D: Transaction data leak | server gate replaces data with PaywallStubCard | free-tier-1 |
| T-02-E: LGPD revocation rollback | Pluggy DELETE first; 502 on failure, no local change | disconnect-2 |
| T-02-F: Disconnect without confirmation | typed DISCONNECT phrase required | E2E + DisconnectConfirmModal |

## Self-Check: PASSED

- [x] src/components/layout/AuthenticatedShell.tsx — EXISTS
- [x] src/components/transactions/TransactionList.tsx — EXISTS
- [x] src/components/transactions/EmptyTransactions.tsx — EXISTS
- [x] src/components/connections/ConnectionCard.tsx — EXISTS
- [x] src/components/connections/DisconnectConfirmModal.tsx — EXISTS
- [x] src/app/transactions/page.tsx — EXISTS
- [x] src/app/settings/connections/page.tsx — EXISTS
- [x] src/app/api/pluggy/items/[id]/sync/route.ts — EXISTS
- [x] src/app/api/pluggy/items/[id]/route.ts — EXISTS
- [x] Build exits 0 — CONFIRMED
- [x] 9/9 integration tests pass — CONFIRMED
- [x] Commits 861587f, 7290334, fbb0bba — CONFIRMED
