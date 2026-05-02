---
phase: 02
slug: pluggy-ingestion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
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
| TBD | TBD | TBD | LGPD-02 | TBD | Per-connector consent row appended before connect token issued | integration | `npm run test:integration -- consent` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONN-01 | TBD | Connect-token endpoint requires session + writes consent atomically | integration | `npm run test:integration -- connect-token` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONN-02 | TBD | Webhook receiver validates header + idempotent on event_id | integration | `npm run test:integration -- pluggy-webhook` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONN-03 | TBD | LOGIN_ERROR item surfaces banner + reconnect deep link | E2E | `npm run test:e2e -- reauth` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONN-04 | TBD | Reconnect deep-link issues update-mode token, sandbox login_succeeded clears banner | E2E | `npm run test:e2e -- reconnect` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONN-05 | TBD | Disconnect calls Pluggy DELETE + appends REVOKED consent row | integration | `npm run test:integration -- disconnect` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONN-06 | TBD | Manual sync respects 30-min cooldown server-side | integration | `npm run test:integration -- cooldown` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CONN-07 | T-02-A | pluggy_item_id stored ciphertext only; never logged | integration | `npm run test:integration -- pluggy-item-encryption` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TX-01 | TBD | UNIQUE(pluggy_transaction_id) + upsert; 3x replay = same DB state | integration | `npm run test:integration -- tx-dedup` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TX-02 | TBD | PENDING→POSTED transition via ON CONFLICT DO UPDATE on cursor refresh | integration | `npm run test:integration -- tx-status-transition` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TX-03 | TBD | Transfer detector: same |amount|, opposite type, ≤3d → flag both legs + transfer_pair_id | unit | `npm run test:unit -- TransferDetector` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TX-04 | TBD | Fatura detector: checking debit ≈ card balance near due date → is_credit_card_payment=true | unit | `npm run test:unit -- FaturaDetector` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TX-05 | TBD | Free-tier read layer caps visible window to 3 months; sync layer always 12 | integration | `npm run test:integration -- free-tier-window` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | TX-06 | TBD | Reconciliation cron enqueues pluggy-sync for items >12h stale | integration | `npm run test:integration -- reconcile-stale` | ❌ W0 | ⬜ pending |

> Task IDs and Threat Refs are filled in by the planner once plans land.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/pluggy/connect-token.test.ts` — covers LGPD-02, CONN-01
- [ ] `tests/integration/pluggy/webhook.test.ts` — covers CONN-02 (replay idempotency, invalid header)
- [ ] `tests/integration/pluggy/disconnect.test.ts` — covers CONN-05
- [ ] `tests/integration/pluggy/cooldown.test.ts` — covers CONN-06
- [ ] `tests/integration/pluggy/encryption.test.ts` — covers CONN-07
- [ ] `tests/integration/pluggy/tx-dedup.test.ts` — covers TX-01, TX-02
- [ ] `tests/integration/pluggy/free-tier.test.ts` — covers TX-05
- [ ] `tests/integration/pluggy/reconcile.test.ts` — covers TX-06
- [ ] `tests/unit/services/TransferDetector.test.ts` — covers TX-03
- [ ] `tests/unit/services/FaturaDetector.test.ts` — covers TX-04
- [ ] `tests/e2e/pluggy/reauth.spec.ts` — covers CONN-03, CONN-04 via Pluggy sandbox state-trigger users
- [ ] Pluggy SDK fixtures: `tests/fixtures/pluggy/*.json` (webhook payloads, item lifecycle samples)
- [ ] Sandbox env block in `.env.test`: `PLUGGY_SANDBOX_CLIENT_ID`, `PLUGGY_SANDBOX_CLIENT_SECRET`, `PLUGGY_ENV=sandbox`

*All test files above are NEW for Phase 2; framework already installed in Phase 1.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cloudflare WAF rule rejects non-Pluggy IPs at edge (defense in depth, D-42) | CONN-02 | Edge runs in production only | (1) Deploy WAF rule via Cloudflare dashboard or Terraform. (2) Send POST from non-allowlisted IP to `/api/webhooks/pluggy` → expect 403 at edge before app sees request. |
| Sandbox `user-locked` state-trigger transitions item to LOGIN_ERROR; banner appears in UI | CONN-03 | Requires Pluggy sandbox connector + browser session | (1) Connect Itau sandbox connector with username `user-locked`. (2) Confirm `pluggy_items.status='LOGIN_ERROR'` after webhook. (3) Reload `/transactions` → confirm global banner. (4) Click "Reconectar" → widget opens in update mode. |
| Re-auth email arrives in inbox with correct CTA URL pointing to `/connect?reconnect=<uuid>` | CONN-04 | SES live-fire | (1) Trigger `item/error` webhook in sandbox. (2) Confirm email received within 60s. (3) Confirm CTA URL contains `<uuid>` not Pluggy item id. (4) Confirm plaintext alternate body present. |
| 12-month initial sync depth respected; no transaction older than 12 months from sync time | TX-01 / TX-05 | Requires real Pluggy sandbox response inspection | (1) Connect Pluggy Bank sandbox. (2) After sync: `SELECT MIN(posted_at) FROM transactions WHERE user_id=<test>` ≥ now() - interval '12 months 1 day'. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — planner fills Task IDs in Per-Task Verification Map after PLAN.md files land.
