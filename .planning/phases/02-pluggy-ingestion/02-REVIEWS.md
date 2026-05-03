---
phase: 02
reviewers: [codex]
reviewed_at: 2026-05-03
plans_reviewed:
  - 02-01-PLAN.md
  - 02-02-PLAN.md
  - 02-03-PLAN.md
  - 02-04-PLAN.md
  - 02-05-PLAN.md
  - 02-06-PLAN.md
  - 02-07-PLAN.md
  - 02-08-PLAN.md
  - 02-09-PLAN.md
  - 02-10-PLAN.md
notes: |
  Cross-AI review run with --all but only codex (gpt-5.5) was usable in this environment.
  - claude was skipped per workflow rule (running inside Claude Code; self-review defeats independence).
  - cursor present is the IDE launcher (cursor.exe v2.4.28), not the headless `cursor-agent` CLI.
  - gemini, codex (now installed), coderabbit, opencode, qwen were initially missing; codex was installed during this run.
  Consensus/divergence sections are not meaningful with a single reviewer and are omitted.
---

# Cross-AI Plan Review — Phase 02 (Pluggy Ingestion)

## Codex Review (gpt-5.5)

## Summary

Phase 02 is unusually thorough and mostly well-structured: it decomposes Pluggy ingestion into sensible waves, captures the major domain risks, and repeatedly closes real gaps discovered during UAT. The plans strongly cover encryption, consent, webhook idempotency, async ingestion, cooldowns, re-auth, and raw transaction visibility. The main weaknesses are scope size, several subtle correctness gaps in the sync/detector design, some over-complicated server-only remediation, and a few places where plans say "success criterion covered" while the implementation/test evidence is weaker than the roadmap requirement. Overall, this is a strong but high-complexity phase that needs a final hardening pass before execution/ship.

## Strengths

- **Clear end-to-end ingestion architecture.** The consent → token → widget → item persistence → webhook → queue → sync worker flow is coherent and follows the project constraint that Pluggy sync must not happen in request handlers.

- **Good security posture on core identifiers.** `pluggy_item_id` encryption at rest, HMAC lookup via `PLUGGY_ITEM_ID_HASH_PEPPER`, no plaintext IDs in URLs, and IDOR-by-user filters are all explicitly planned.

- **Webhook idempotency is treated correctly.** `webhook_events` with `UNIQUE(source, event_id)` plus replay tests directly addresses roadmap success criterion #2.

- **Consent model is LGPD-aware.** The two-row `PLUGGY_CONNECT_PENDING` + `PLUGGY_CONNECTOR:{id}` approach is defensible and auditable.

- **Async jobs and per-user sync serialization are appropriate.** `pg-boss` singleton by `user_id` is a good baseline to avoid self-inflicted Pluggy API storms.

- **Gap-closure plans show useful feedback loops.** Plans 02-07 through 02-10 respond to concrete UAT failures rather than hand-waving them away.

- **Test planning is extensive.** The phase includes tests for invalid CPF zero writes, webhook replay, broken item skip, dedup, PENDING→POSTED, cooldown, free tier, disconnect, transfer/fatura detectors, and server-only regressions.

## Concerns

- **HIGH — Success criterion #1 may still be under-proven.**
  Plans 02-03, 02-04, 02-06 claim `/connect` → transactions within 60 seconds, but the E2E plan uses mocked widget and mocked sync-status. That proves UI navigation, not that sandbox Pluggy connect plus worker ingestion lands accounts and transactions within 60 seconds. The roadmap criterion specifically says sandbox bank and visible data.

- **HIGH — Webhook handler may do too much in the hot path.**
  `02-04-PLAN.md`, Task 1 adds dynamic imports, DB lookup, hashing, and `recordAudit()` inline for `item/login_succeeded` before returning. This conflicts with the earlier "receiver only auth + insert + enqueue" pattern and may threaten the <200ms target under load.

- **HIGH — Sync worker plaintext item ID handling contradicts the security intent.**
  `02-04-PLAN.md`, Task 1 enqueues `item_id_pluggy` from webhook payload into pg-boss job data. That means plaintext Pluggy item IDs are stored in pg-boss tables. This conflicts with the roadmap success criterion #6: `pluggy_item_id` is never visible in plaintext in DB. pg-boss job payload is DB state.

- **HIGH — `webhook_events.payload` stores raw Pluggy payload unencrypted.**
  The context explicitly accepts this as Phase 2 risk, but roadmap success criterion #6 says `pluggy_item_id` is never visible in plaintext in the DB. If Pluggy webhook payload includes `itemId`, storing it in `webhook_events.payload` violates the criterion unless the receiver redacts/encrypts `itemId` before insert.

- **HIGH — Transfer detection can over-pair ambiguous transactions.**
  `02-05-PLAN.md`, Task 1 uses a broad self-join and updates all candidates. If one debit matches multiple credits of the same amount within 3 days, the CTE can produce multiple pairs and set unstable `transfer_pair_id` values. The plan has a negative "three matching transactions" test in research, but the actual 02-05 behavior list does not include it.

- **HIGH — Fatura detector is likely too weak for real-world correctness.**
  `02-05-PLAN.md`, Task 1 matches checking/savings debit amount to credit-card account balance near `accounts.updated_at`. Credit card balance is not necessarily the statement amount due, and `updated_at` is sync time, not due date. This may generate false positives. The plan documents a Phase 6 follow-up, but success criterion #5 expects this to work now.

- **MEDIUM — Broken item state handling is incomplete.**
  Plans skip `LOGIN_ERROR` and `WAITING_USER_INPUT`, but `OUTDATED` is sometimes treated as broken in UI and reconciliation context, sometimes syncable. `02-04` skip logic omits `OUTDATED`, while success criterion #3 says no sync is triggered on broken items. The exact broken-state taxonomy should be centralized.

- **MEDIUM — `pluggy_items` lacks an explicit disconnected/deleted lifecycle state.**
  `item_status_enum` has no `DELETED` or `DISCONNECTED`. Plans work around this by marking accounts `DELETED`, but active item counting, sync route behavior, and reconnect banners can become ambiguous. This is visible in `02-03-PLAN.md` where active-item counting gets awkward.

- **MEDIUM — Disconnect flow does not prevent future syncs robustly.**
  `02-06-PLAN.md`, DELETE marks accounts `DELETED` but leaves `pluggy_items.status` unchanged. A webhook or stale queued job for that item could still run unless the worker checks account status or consent revocation. The plan says it "finds zero accounts," but sync fetches accounts from Pluggy first and may recreate/upsert active accounts.

- **MEDIUM — pg-boss singleton semantics may not dedupe queued backlog as intended.**
  Plans assume `singletonHours: 0` means in-flight only. That may still allow multiple jobs for the same user to queue sequentially if the first has not started or if payload differs. The implementation should verify pg-boss v12 behavior and add explicit DB-level sync lock if needed.

- **MEDIUM — Route tests rely on brittle mocking/import patterns.**
  Several integration tests mock `@/services/PluggyService` before direct route imports. In Next/App Router route modules, module cache ordering can make these tests fragile unless `vi.resetModules()` is carefully controlled, which conflicts with 02-09's singleton testcontainer rationale.

- **MEDIUM — `serverOnly.ts` plan is internally contradictory.**
  `02-10-PLAN.md` says plain Node/tsx callers "walk through this file, see no DOM, and pass," but `src/lib/serverOnly.ts` still has top-level `import 'server-only';`. In plain Node/tsx, importing that helper may still trigger the same CJS throw before `assertServerOnly()` runs. The plan's own premise says this is exactly what broke 02-07.

- **MEDIUM — Gap-closure plans add substantial complexity.**
  Plans 02-07 through 02-10 modify env loading, test runner process model, module boundaries, scripts, and fixtures. Some are justified, but the combined changes increase maintenance risk and may obscure the original Pluggy phase objectives.

- **MEDIUM — Full deletion and webhook payload PII are deferred, but risk remains visible.**
  LGPD full deletion is explicitly Phase 6, which is acceptable scope-wise, but raw transaction payloads and webhook payloads can contain sensitive financial data. The plans need stronger "not exposed, retention, redaction" language for Phase 2.

- **LOW — `last_synced_at` as manual-sync cooldown anchor is blunt.**
  Cooldown based on `last_synced_at` means failed manual sync attempts may not cool down, and recent automatic syncs block manual sync. That may be acceptable, but it should be deliberate.

- **LOW — UI implementation scope is large for one plan.**
  `02-06-PLAN.md` combines pages, shell, cards, modals, API routes, E2E, and filters. It is a high-change plan where visual regressions and route bugs may hide.

## Suggestions

1. **Redact or avoid plaintext Pluggy IDs everywhere outside `pluggy_items.pluggy_item_id_enc`.**
   Do not store `item_id_pluggy` in pg-boss payloads or `webhook_events.payload`. On webhook receipt, compute `hashPluggyItemId(body.itemId)`, store/redact payload, and enqueue by internal item UUID or item hash.

2. **Move `item/login_succeeded` audit resolution out of the webhook route.**
   Let the webhook route insert and enqueue only. Put reauth-success audit into a worker that can tolerate retries and slower DB lookups.

3. **Add a real sandbox phase gate for success criterion #1.**
   Keep mocked E2E, but add a nightly/manual test that uses Pluggy sandbox credentials and asserts accounts + transactions visible within 60 seconds. Record last successful run timestamp.

4. **Introduce an explicit local disconnected state.**
   Add `DISCONNECTED` to `item_status_enum` or a separate `disconnected_at` column on `pluggy_items`. Then exclude disconnected items in `/connect`, sync workers, banners, reconnect, reconciliation, and manual sync.

5. **Centralize item-state policy.**
   Add a helper like `isSyncableItemStatus(status)` and `needsReauth(status, executionStatus)` and use it in workers, UI, reconcile, and sync route. This avoids drift around `OUTDATED`.

6. **Make transfer pairing deterministic under ambiguity.**
   Add ranking: nearest timestamp delta, then deterministic ID order, and ensure each transaction appears in at most one pair. Add tests for one-to-many same amount cases.

7. **Downgrade or harden fatura success criterion.**
   Prefer using Pluggy credit card bill/due fields if available. If unavailable, label Phase 2 detector as "best-effort" and add tests for common false positives: same amount purchase, transfer to another account, partial card payment, overpayment, multiple cards with same balance.

8. **Verify pg-boss singleton behavior with a focused test.**
   Add a test that enqueues 5 sync jobs for one user concurrently and proves only one runs or only one is present, depending on intended semantics.

9. **Revisit `serverOnly.ts` design before implementation.**
   If top-level `import 'server-only'` still crashes under tsx, use `server-only` only in Next-only leaf modules or rely on static import graph tests plus runtime `assertServerOnly()`. The current plan may reproduce the same failure one module deeper.

10. **Split 02-06 or add visual smoke screenshots.**
    The UI plan is broad. At minimum, add Playwright screenshots for `/transactions` empty/loaded/paywall states and `/settings/connections` healthy/broken/cooldown states.

11. **Add retention/redaction policy for sensitive JSONB payloads.**
    Even if encryption is deferred, document retention, API non-exposure, and log prohibition for `raw_payload` and `webhook_events.payload`.

## Risk Assessment

**Overall risk: HIGH.**

The architecture is fundamentally sound, and the plans are detailed, but the phase touches sensitive financial ingestion, consent, encryption, webhook processing, async jobs, and multiple UIs at once. The highest risks are not missing features but correctness/security mismatches: plaintext Pluggy IDs in webhook/job tables, over-broad detector heuristics, ambiguous disconnected item lifecycle, and possible server-only remediation flaws. With the suggested hardening, especially around plaintext ID handling and item state lifecycle, the risk can move down to **MEDIUM**.

---

## Top Concerns At A Glance

Single-reviewer call-outs (no consensus possible with one reviewer):

1. **Plaintext `pluggy_item_id` leakage** into `webhook_events.payload` and pg-boss job payloads — directly contradicts roadmap success criterion #6.
2. **Success criterion #1** (sandbox connect → transactions visible in 60s) is asserted by mocked E2E only; needs a real-sandbox gate.
3. **Detector correctness** — transfer over-pairing under ambiguity and fatura detector keying off `accounts.updated_at` instead of statement/due fields.
4. **Item lifecycle gap** — no `DISCONNECTED`/`DELETED` status on `pluggy_items`; disconnect flow leaves item active and re-syncable.
5. **`serverOnly.ts` design** may reproduce the exact tsx-crash it was meant to fix.

To incorporate this feedback into a follow-up plan: `/gsd-plan-phase 02 --reviews`.
