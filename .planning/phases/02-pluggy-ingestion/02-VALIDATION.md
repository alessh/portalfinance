---
phase: 02
slug: pluggy-ingestion
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-01
updated: 2026-05-02
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.0.5 (workspace: unit + integration) + Playwright 1.51 (E2E) |
| **Config file** | vitest.config.ts (workspace[]), playwright.config.ts |
| **Quick run command** | `npm run test:unit -- --reporter=dot` |
| **Full suite command** | `npm run test && npm run test:e2e` |
| **Estimated runtime** | ~120 seconds (unit ~25s + integration ~45s + E2E ~50s) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- --reporter=dot` (target file scope)
- **After every plan wave:** Run full unit + integration: `npm run test`
- **Before `/gsd-verify-work`:** Full suite (unit + integration + E2E sandbox) must be green
- **Max feedback latency:** 30 seconds for per-task sampling

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-03-T2 | 02-03 | 2 | LGPD-02, CONN-01 | T-02-G | Per-connector consent row appended before connect token issued; pre-row appended FIRST | integration | `npm run test:integration -- pluggy/connect-token pluggy/connect-init` | ✅ created in 02-03 | ⬜ pending |
| 02-03-T2 | 02-03 | 2 | CONN-01 | T-02-C, T-02-D | Connect-token endpoint requires session + writes consent atomically; no DB write on invalid CPF | integration | `npm run test:integration -- pluggy/connect-token` | ✅ created in 02-03 | ⬜ pending |
| 02-04-T1 | 02-04 | 3 | CONN-02 | T-02-A, T-02-B | Webhook receiver validates header (constant-time) + idempotent on event_id | integration | `npm run test:integration -- pluggy/webhook` | ✅ created in 02-04 | ⬜ pending |
| 02-05-T2 | 02-05 | 4 | CONN-03 | T-02-D | LOGIN_ERROR item surfaces banner via AuthenticatedShell + reconnect deep link via /connect?reconnect=UUID | integration + E2E | `npm run test:integration -- pluggy/reauth-notifier && npm run test:e2e -- pluggy` | ✅ created in 02-05 / 02-06 | ⬜ pending |
| 02-05-T2 | 02-05 | 4 | CONN-04 | T-02-B | Reconnect deep-link issues update-mode token via /api/connect/init reconnect_item_id; sandbox login_succeeded clears banner | E2E | `npm run test:e2e -- pluggy` | ✅ E2E in 02-06 | ⬜ pending |
| 02-06-T2 | 02-06 | 5 | CONN-05, LGPD-02 | T-02-E, T-02-F | Disconnect calls Pluggy DELETE + appends REVOKED consent row + cascades accounts.status='DELETED' + audit | integration | `npm run test:integration -- pluggy/disconnect` | ✅ created in 02-06 | ⬜ pending |
| 02-06-T2 | 02-06 | 5 | CONN-06 | T-02-B | Manual sync respects 30-min cooldown server-side; 429 with Retry-After | integration | `npm run test:integration -- pluggy/cooldown` | ✅ created in 02-06 | ⬜ pending |
| 02-02-T1 | 02-02 | 1 | CONN-07 | T-02-A, T-02-B, T-02-C | pluggy_item_id stored ciphertext only; never logged; PluggyService is the only decrypt boundary; error messages scrubbed | unit + integration | `npm run test:unit -- services/PluggyService && npm run test:integration -- pluggy/encryption` | ✅ created in 02-02 | ⬜ pending |
| 02-04-T2 | 02-04 | 3 | TX-01 | T-02-D | UNIQUE(pluggy_transaction_id) + ON CONFLICT DO UPDATE; 3x replay = same DB state | integration | `npm run test:integration -- pluggy/tx-dedup pluggy/sync-worker` | ✅ created in 02-04 | ⬜ pending |
| 02-04-T2 | 02-04 | 3 | TX-02 | T-02-E | PENDING→POSTED transition via ON CONFLICT DO UPDATE on cursor refresh; detector flags preserved | integration | `npm run test:integration -- pluggy/sync-worker` | ✅ created in 02-04 | ⬜ pending |
| 02-05-T1 | 02-05 | 4 | TX-03 (transfer) — note: requirements ID set was TX-04 in REQUIREMENTS.md; both detector + webhook coverage | T-02-A, T-02-F | Transfer detector: same |amount|, opposite type, ≤3d → flag both legs + transfer_pair_id; deterministic SQL self-join | unit (with testcontainers) | `npm run test -- TransferDetector` | ✅ created in 02-05 | ⬜ pending |
| 02-05-T1 | 02-05 | 4 | TX-04 | T-02-A | Fatura detector: checking debit ≈ card balance → is_credit_card_payment=true | unit (with testcontainers) | `npm run test -- FaturaDetector` | ✅ created in 02-05 | ⬜ pending |
| 02-06-T1 | 02-06 | 5 | BILL-04 stub (read-layer) | T-02-D | Free-tier read layer caps visible window to 3 months via PaywallStubCard; sync layer always 12; tier-gate at /transactions SSR + /api/pluggy/items/:id/sync (Phase 5 BILL-04 stub; TX-05 fatura detection coverage moved to row 02-05-T1) | integration | `npm run test:integration -- pluggy/free-tier` | ✅ created in 02-06 | ⬜ pending |
| 02-05-T2 | 02-05 | 4 | TX-06 | T-02-D | Reconciliation cron enqueues pluggy-sync for items >12h stale; warning log if >5 stale | integration | `npm run test:integration -- pluggy/reconcile` | ✅ created in 02-05 | ⬜ pending |

**Note on requirement IDs:** The CONTEXT.md / REQUIREMENTS.md mapping for transaction ingestion uses TX-01..TX-06. Plan 02 covers all six: TX-01 (dedup) + TX-02 (overlap) + TX-03 (webhook events) + TX-04 (transfers) + TX-05 (fatura) + TX-06 (reconciliation). The TX-03 row above tracks transfer-detector coverage as a representative; the broader webhook event handling for TX-03 is exercised in 02-04 webhook tests.

> Task IDs use the format `{plan}-T{taskNumber}` (e.g., 02-04-T2 = plan 02-04, task 2).

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 scaffolding lands in plan 02-02 Task 1 (PluggyService unit tests + encryption integration test + 6 fixture JSONs). Per-feature integration tests land alongside the implementation in subsequent plans, NOT all upfront — this matches the GSD "interface-first" pattern (contracts ship in plan 02-02, behaviors prove themselves in the plan that ships them).

- [ ] `tests/integration/pluggy/connect-token.test.ts` — covers LGPD-02, CONN-01 (created in plan 02-03)
- [ ] `tests/integration/pluggy/webhook.test.ts` — covers CONN-02 (created in plan 02-04)
- [ ] `tests/integration/pluggy/disconnect.test.ts` — covers CONN-05 (created in plan 02-06)
- [ ] `tests/integration/pluggy/cooldown.test.ts` — covers CONN-06 (created in plan 02-06)
- [ ] `tests/integration/pluggy/encryption.test.ts` — covers CONN-07 (created in plan 02-02 — Wave 0)
- [ ] `tests/integration/pluggy/tx-dedup.test.ts` — covers TX-01, TX-02 (created in plan 02-04)
- [ ] `tests/integration/pluggy/free-tier.test.ts` — covers TX-05 (created in plan 02-06)
- [ ] `tests/integration/pluggy/reconcile.test.ts` — covers TX-06 (created in plan 02-05)
- [ ] `tests/integration/pluggy/sync-worker.test.ts` — covers worker behavior + Pitfall P2 broken-item skip (created in plan 02-04)
- [ ] `tests/integration/pluggy/reauth-notifier.test.ts` — covers D-34 + D-35 (created in plan 02-05)
- [ ] `tests/integration/pluggy/connect-init.test.ts` — covers /api/pluggy/items behavior + sync-status (created in plan 02-03)
- [ ] `tests/unit/services/TransferDetector.test.ts` — covers TX-04 / D-33 (created in plan 02-05)
- [ ] `tests/unit/services/FaturaDetector.test.ts` — covers TX-05 / Pitfall P8 (created in plan 02-05)
- [ ] `tests/unit/services/PluggyService.test.ts` — covers CONN-07 + log scrubbing (created in plan 02-02 — Wave 0)
- [ ] `tests/e2e/pluggy/connect-flow.spec.ts` — covers CONN-03, CONN-04 happy path (created in plan 02-06)
- [ ] Pluggy SDK fixtures: `tests/fixtures/pluggy/*.json` — 6 files (created in plan 02-02 — Wave 0)
- [ ] Sandbox env block in `scripts/run-e2e.ts` `.env.local` write: `PLUGGY_SANDBOX_CLIENT_ID`, `PLUGGY_SANDBOX_CLIENT_SECRET`, `PLUGGY_ENV=sandbox` (created in plan 02-01)

*All test files above are NEW for Phase 2; framework already installed in Phase 1.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cloudflare WAF rule rejects non-Pluggy IPs at edge (defense in depth, D-42) | CONN-02 | Edge runs in production only | (1) Deploy WAF rule per `docs/ops/cloudflare-waf-pluggy.md` (created in plan 02-04). (2) Send POST from non-allowlisted IP to `/api/webhooks/pluggy` → expect 403 at edge before app sees request. |
| Sandbox `user-locked` state-trigger transitions item to LOGIN_ERROR; banner appears in UI | CONN-03 | Requires Pluggy sandbox connector + browser session | (1) Connect Itau sandbox connector with username `user-locked`. (2) Confirm `pluggy_items.status='LOGIN_ERROR'` after webhook. (3) Reload `/transactions` → confirm global banner. (4) Click "Reconectar" → widget opens in update mode. |
| Re-auth email arrives in inbox with correct CTA URL pointing to `/connect?reconnect=<uuid>` | CONN-04 | SES live-fire | (1) Trigger `item/error` webhook in sandbox. (2) Confirm email received within 60s. (3) Confirm CTA URL contains internal `<uuid>` not Pluggy item id. (4) Confirm plaintext alternate body present. |
| 12-month initial sync depth respected; no transaction older than 12 months from sync time | TX-01 / TX-05 | Requires real Pluggy sandbox response inspection | (1) Connect Pluggy Bank sandbox. (2) After sync: `SELECT MIN(posted_at) FROM transactions WHERE user_id=<test>` ≥ now() - interval '12 months 1 day'. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (PluggyService unit + encryption integration + fixtures land in plan 02-02)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Task IDs filled in by planner 2026-05-02. Pending execution sign-off.
