---
status: partial
phase: 02-pluggy-ingestion
source: [02-VERIFICATION.md]
started: 2026-05-02T13:00:00Z
updated: 2026-05-02T13:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end connect flow against Pluggy sandbox (criterion 1)
expected: User opens `/connect`, grants consent, completes Pluggy Connect for a sandbox bank, and within 60 seconds sees accounts and transactions on `/transactions`.
why_human: Live Pluggy sandbox credentials + running Next.js server + running pg-boss worker + 60s timing window.
how: Set `PLUGGY_SANDBOX_CLIENT_ID` / `PLUGGY_SANDBOX_CLIENT_SECRET` in `.env`, run `pnpm dev` and `pnpm start:worker`, sign in, navigate `/connect`.
result: [pending]

### 2. Webhook idempotency replay (criterion 2)
expected: Posting the same Pluggy webhook event 3 times produces identical DB state (no duplicate `webhook_events` rows, no double sync). Posting an invalid `X-Pluggy-Signature` header returns 401.
why_human: Requires live Postgres + pg-boss test mode; covered by `tests/integration/pluggy/webhook.test.ts` (7 scenarios). Run via `npm run test:integration -- pluggy/webhook` (Docker / testcontainers required).
result: [pending]

### 3. LOGIN_ERROR reconnect banner (criterion 3)
expected: An item forced into `LOGIN_ERROR` displays the persistent ReAuthBanner; clicking "Reconnect" opens Pluggy Connect for that specific item; no sync is enqueued for the broken item.
why_human: Visual browser render + Pluggy sandbox forcing a login error.
how: Seed a `pluggy_items` row with `status='LOGIN_ERROR'` (or trigger via Pluggy sandbox), refresh the app, click banner CTA.
result: [pending]

### 4. Transfer detection end-to-end (criterion 4)
expected: A cross-account transfer (debit on checking, credit on savings, opposite-sign equal amount within ±3 days) is flagged `is_transfer=true` on both rows; monthly aggregates exclude the pair.
why_human: Requires Postgres + worker; covered by `tests/integration/services/TransferDetector.test.ts` (6 scenarios). Run via `npm run test:integration -- TransferDetector`.
result: [pending]

### 5. Fatura detection end-to-end (criterion 5)
expected: A credit-card fatura payment (checking debit matching card balance within ±7 days) is flagged `is_credit_card_payment=true` and excluded from expense aggregates; individual card-line-item transactions remain as expenses.
why_human: Requires Postgres + worker; covered by `tests/integration/services/FaturaDetector.test.ts` (4 scenarios). Run via `npm run test:integration -- FaturaDetector`.
result: [pending]

### 6. pluggy_item_id ciphertext confirmation (criterion 6)
expected: A direct `SELECT pluggy_item_id_enc FROM pluggy_items LIMIT 1;` returns ciphertext (length differs from plaintext, first byte varies across writes); no log line, error message, or API response contains a plaintext Pluggy item ID.
why_human: Requires running migrations + at least one connected item; covered by `tests/integration/pluggy/encryption.test.ts`. Run `psql -c "SELECT length(pluggy_item_id_enc), encode(pluggy_item_id_enc, 'hex') FROM pluggy_items LIMIT 3;"` and grep app logs.
result: [pending]

### 7. Manual sync cooldown + free-tier paywall (criterion 7)
expected: Requesting manual sync inside the 30-minute cooldown returns a clear "please wait N minutes" message. Free-tier users (no active subscription) cannot trigger manual sync at all (paywall response).
why_human: Requires running app + seeded subscription state; covered by `tests/integration/pluggy/cooldown.test.ts` + `tests/integration/pluggy/free-tier.test.ts`. Run `npm run test:integration -- pluggy/cooldown` and `npm run test:integration -- pluggy/free-tier`, plus a manual UI click.
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
