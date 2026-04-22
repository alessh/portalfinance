# Pitfalls Research

**Domain:** Brazilian personal finance PWA — Open Finance (Pluggy), LGPD, subscription billing, categorization engine
**Researched:** 2026-04-22
**Confidence:** HIGH for LGPD statutory requirements and Open Finance mechanics; MEDIUM for Pluggy-specific API behaviors (verify against https://docs.pluggy.ai before implementation)

---

## Critical Pitfalls (CRITICAL severity)

### P1. Losing Transactions on Partial Re-Sync (no deduplication) — Ingestion

- **What goes wrong:** plain `INSERT` of Pluggy responses silently duplicates rows when sync windows overlap; user's totals double; trust destroyed.
- **Prevention:** `UNIQUE (pluggy_transaction_id)` + `INSERT … ON CONFLICT (pluggy_transaction_id) DO UPDATE`. Always overlap sync windows by N+7 days. Never delete rows missing from the latest window.
- **Warning signs:** duplicate rows by `pluggy_transaction_id`; monthly totals exactly 2× expected; user reports "same expense twice."
- **Phase:** Ingestion (phase 1).

### P2. Ignoring Item States (STALE / LOGIN_ERROR / WAITING_USER_INPUT) — Ingestion

- **What goes wrong:** only `UPDATED` handled; broken items sit silently; sync keeps being triggered burning quota.
- **Prevention:** explicit enum in `pluggy_items.status`; webhook writes transitions; UI surfaces a per-item re-auth banner; never trigger sync on `LOGIN_ERROR`/`WAITING_USER_INPUT`; background notifier after 24h.
- **Phase:** Ingestion (phase 1).

### P3. Missing Webhook Auth Verification + Idempotency — Ingestion

- **What goes wrong:** anyone can inject events; retries cause duplicate processing.
- **Prevention:** verify auth header (custom shared secret; Pluggy does not use HMAC); IP allowlist `177.71.238.212` if applicable; `webhook_events` table with `UNIQUE(event_id)`; `INSERT … ON CONFLICT DO NOTHING RETURNING id`; return 200 < 5 s; actual processing in worker.
- **Phase:** Ingestion (phase 1).

### P4. Plaintext Pluggy Item IDs / Tokens — Ingestion

- **What goes wrong:** DB breach = full financial history exposed.
- **Prevention:** AES-256-GCM at application layer; key in env/KMS; never log; `PluggyService` is the only decryption point.
- **Phase:** Ingestion, day 1.

### P5. Synchronous Pluggy Sync Inside HTTP Handler — Ingestion

- **What goes wrong:** syncs take 10–90 s, handler times out, UX broken, no recovery.
- **Prevention:** handler enqueues pg-boss job and returns 202; worker does the work; client polls `/api/sync-status`.
- **Phase:** Ingestion, day 1.

### P11. Missing Per-Data-Source Consent Records — Auth/Onboarding (LGPD)

- **What goes wrong:** one generic ToS checkbox is not per-source explicit consent; violates LGPD Art. 7 + 8.
- **Prevention:** consent screen before each Pluggy Connect opens; write `user_consents` row with scope, IP, UA, timestamp; append-only (revocations are new rows); audit trail exposed in privacy settings.
- **Phase:** Auth/Onboarding (phase 1).

### P12. Incomplete Data Deletion — Auth/Onboarding (LGPD)

- **What goes wrong:** `DELETE FROM users` cascades but misses Pluggy items, backups, logs, email list, Sentry breadcrumbs.
- **Prevention:** deletion is a multi-step async workflow — call Pluggy `DELETE /items/:id`, anonymize PII in logs, remove from email lists, soft-delete DB, hard-delete after 30 days legal hold. Log every step in `deletion_audit_log`. Backup retention ≤ 30 days with auto-expire.
- **Phase:** Auth/Onboarding; LGPD hardening (phase 5).

### P13. PII in Logs / Error Tracking — Cross-cutting (LGPD)

- **What goes wrong:** `console.log({ transaction })` dumps description with CPF/PIX names into CloudWatch/Sentry.
- **Prevention:** `sanitize()` wrapper used everywhere; `Sentry.init({ beforeSend })` scrubs `cpf`, `description`, `descriptionRaw`, `account_number`; log retention ≤ 30 days with auto-expire; log IDs and categories only.
- **Phase:** Ingestion, day 1.

### P14. Cross-border LLM Calls with Raw Descriptions — Categorization (LGPD)

- **What goes wrong:** "PIX recebido de JOAO DA SILVA CPF 123.456.789-00 ref salario" sent to US LLM without a DPA — LGPD Art. 33 violation.
- **Prevention:** PII scrubber (regex for CPF pattern, PIX name pattern, account numbers) before every LLM prompt; sign DPA with the provider; prefer Gemini Flash 2.0 with signed DPA; evaluate Maritaca (BR-hosted) for v2; never pass raw description.
- **Phase:** Categorization (phase 2).

### P22. Not Emitting NFS-e — Billing

- **What goes wrong:** Brazilian SaaS must issue NFS-e per charge; omission is a tax violation and blocks MEI/SMB subscribers.
- **Prevention:** choose ASAAS or Iugu with native NFS-e; register with the municipal Secretaria de Finanças; store `nfse_number` and PDF URL in `billing_events`; verify emission for every charge in staging before production launch.
- **Phase:** Billing (phase 4).

### P26. IDOR on Transaction Endpoints — Auth/Security

- **What goes wrong:** `GET /api/transactions/:id` returns without ownership check; attacker enumerates and reads all users' transactions.
- **Prevention:** every query includes `AND user_id = $session.user.id` (or joins via `accounts → user_id`); use UUIDs (not sequential ints); 404 for unauthorized (don't confirm existence); integration tests verify user B cannot fetch user A's transaction.
- **Phase:** Auth, day 1.

---

## High Pitfalls (HIGH severity)

### P6. Trusting Pluggy's `category` Field — Categorization

- Pluggy's category is often wrong, especially for PIX. Never display it directly. Treat as one weak signal in the rules engine (or ignore entirely).

### P7. Not De-duplicating Internal Transfers — Ingestion

- Transfer between user's own accounts shows up as debit on one + credit on the other → both counted.
- `TransferDetector` worker pairs (same |amount|, opposite type, same user, within 3 days) and marks `is_transfer=true`; aggregates exclude them.

### P8. Credit-card Fatura Double-Counted — Ingestion

- Ingest line items as expenses; detect fatura debit in checking as `is_credit_card_payment=true` and exclude from expense totals.

### P9. No Per-User Sync Rate Limit — Ingestion

- Free-tier users can spam "sync now"; burns API quota and can lock the item on Pluggy's side.
- Per-item cooldown (free: 4 h; paid: 30 min); free tier uses scheduled sync only, no user button.

### P10. Sandbox vs Production Confusion — Ops

- Separate secrets per env; runtime assertion `NODE_ENV==='production' && PLUGGY_ENV!=='production' → throw`; `.gitignore` covers all `.env*`.

### P15. No DSR (Data Subject Request) Workflow — LGPD

- "Export my data" + "Delete my account" on privacy settings; 15-day statutory response; log requests in `dsr_requests`.

### P16. Retention Not Enforced — LGPD

- Scheduled retention worker soft-deletes + hard-deletes after policy windows; privacy policy and code must agree.

### P17. Rules Engine Becomes a Tangle — Categorization

- Rules in DB with `priority`, `condition_type`, `condition_value`, `matched_rule_id` logged on every transaction; merchant normalization eliminates most string-matching chaos.

### P18. LLM Taxonomy Hallucinations — Categorization

- Structured output with closed enum of `category.slug`; post-call validation; invalid → `UNCATEGORIZED` + log; temperature 0; full taxonomy in system prompt.

### P19. Runaway LLM Cost — Categorization

- Per-user daily budget in `llm_usage` table; free tier 0 calls; paid cap; batch N uncategorized per call; historical sync only categorizes last 90 days via LLM; rest falls to rules + user corrections.

### P20. Not Learning from Corrections — Categorization

- User correction → `category_rules` (per-user, priority HIGH); check user rules BEFORE shared; UI confirms "we learned this"; promote to shared after N unanimous corrections (with review).

### P21. No Merchant Normalization — Categorization

- `merchant_aliases` table maps raw patterns → canonical merchant; normalization step (strip punctuation, collapse spaces, remove `LTDA`/`SA`/`*PEDIDO`) runs before rules.

### P23. No Boleto/PIX Recurrence — Billing

- ASAAS / Iugu handle boleto + PIX Cobrança natively; checkout must present all three (card, PIX, boleto); annual plan → single boleto works fine.

### P24. Silent Subscription Failure on Card Expiration — Billing

- Handle `invoice.payment_failed`, `subscription.past_due`, `subscription.canceled`; in-app banner + email within 1 h of first failure; grace period 3–5 days; log every event in `billing_events`.

### P25. Downgrade Deletes Data — Billing

- Downgrade FREEZES excess accounts (`accounts.status='FROZEN'`); UI shows "hidden; upgrade to restore"; hard-delete only after 90 days continuous free status with 7-day warning.

### P27. Admin Access Without Audit Log — Auth/Security

- `admin_access_log` appended on every support view; re-authentication required for admin session; admin views show summaries, not raw descriptions; retained 2 years.

### P28. CPF Not Validated / Stored Wrong — Auth

- Client + server check-digit validation via `@brazilian-utils/br-validations`; store AES-256-GCM encrypted + SHA-256 hash column for uniqueness lookups; never plaintext.

### P29. No Rate Limit on Login / Reset — Auth

- 5 failed logins / 15 min → lockout + unlock email; 3 reset requests / hour / email; Upstash Redis sa-east-1 or Postgres counter; CAPTCHA after 2nd failure.

### P30. Bank Connection Before Any Value — Onboarding UX

- Demo dashboard with sample data first; "this is what yours will look like — connect your bank to see real numbers."

### P32. Paywall Hides Core Feature — Billing/UX

- Free tier includes last 3 months history + categorization + basic dashboard. Paywall gates multi-account, full history, AI assistant, budget rules, export.

### P34. No Recategorization Path After Rule Change — Categorization

- `recategorize_batch` worker: filter by `matched_rule_id IS NULL` or `categorized_at < date`; re-run engine; update; notify via changelog.

### P35. No Webhook Replay After Downtime — Ops

- On restart: reconciliation job queries Pluggy `/items` for every item with `last_synced_at < now()-12h`; triggers sync. Alert if no webhooks received for an active item > 12 h.

### P36. No Observability Until Prod Breaks — Ops

- Structured JSON logs from day 1; metrics: sync success rate, sync duration p50/p95, categorization match rate (rules/LLM/uncategorized), LLM cost/day, webhook lag; alerts at thresholds; Sentry EU from first deploy.

---

## Medium Pitfalls (MEDIUM severity)

### P31. Dashboard Without Delta Comparison — Product/UX

- Every dashboard metric shows delta vs previous month with color coding (green/amber/red). Raw numbers without context are decoration.

### P33. Notification Fatigue from Sync Events — Product/UX

- Silent syncs by default. Notify only for: (1) item broken/re-auth, (2) unusual large transaction, (3) monthly summary ready, (4) payment failed. Per-type toggles in settings.

---

## Technical-Debt Shortcuts to Reject

| Shortcut | Immediate benefit | Long-term cost | Acceptable? |
|----------|-------------------|----------------|-------------|
| Pluggy `category` directly | 0 work at launch | 30 %+ miscategorization, trust gone | Never |
| Sync in HTTP handler | simpler | timeouts, retries, UX broken | Never |
| Plaintext `item_id` | 1 less config | full financial data on breach | Never |
| Skip webhook signature | faster integration | injection attacks | Never |
| Hardcoded rules array | fast to write | unmaintainable at 50+ rules | Never |
| Single ToS consent | faster onboarding | LGPD violation, no audit | Never |
| Skip NFS-e | faster billing | tax violation, SMB blocked | Never |
| No per-user LLM budget | simpler | cost grows linearly with users | Never |
| Skip transfer detection | faster ingestion | doubled totals, user loss | Never |
| Hard-delete on downgrade | simpler | irreversible UX disaster | Never |

---

## "Looks Done But Isn't" Checklist

- [ ] `UNIQUE(pluggy_transaction_id)` verified (not just app-level check)
- [ ] All Pluggy item error states produce user-visible banners
- [ ] Webhook auth verified + idempotency tested (replay same event 3× → no change)
- [ ] Internal transfers excluded from income/expense
- [ ] Credit-card fatura payment excluded; line items ARE the expenses
- [ ] LLM response validated against taxonomy enum
- [ ] Per-user LLM daily budget enforced + tested at the limit
- [ ] `user_consents` row written before Pluggy Connect opens
- [ ] Account deletion calls Pluggy `DELETE /items/:id`, anonymizes logs, removes from email list
- [ ] Sentry `beforeSend` scrubs CPF, descriptions, account numbers (test capture verified)
- [ ] NFS-e issued for every test charge
- [ ] `invoice.payment_failed` → in-app banner + email within 1 h
- [ ] Downgrade freezes, doesn't delete (cancel-and-reactivate test passes)
- [ ] IDOR test: user B cannot fetch user A's transaction
- [ ] Login rate limit: 6th attempt in 15 min → 429
- [ ] Sync success rate metric visible before first real user

---

## Pitfall → Phase Map

| Pitfall | Sev | Phase |
|---------|-----|-------|
| P1 deduplication | CRIT | Ingestion |
| P2 item states | CRIT | Ingestion |
| P3 webhook auth + idempotency | CRIT | Ingestion |
| P4 encrypt item IDs | CRIT | Ingestion (day 1) |
| P5 async sync | CRIT | Ingestion (day 1) |
| P6 trust Pluggy category | HIGH | Categorization |
| P7 transfer dedup | HIGH | Ingestion |
| P8 credit card fatura | HIGH | Ingestion |
| P9 sync rate limit | HIGH | Ingestion |
| P10 sandbox/prod | HIGH | Ingestion (day 1) |
| P11 per-source consent | CRIT | Auth/Onboarding |
| P12 complete deletion | CRIT | LGPD hardening |
| P13 PII in logs | CRIT | Ingestion (day 1) |
| P14 LLM cross-border PII | CRIT | Categorization |
| P15 DSR workflow | HIGH | Auth/Onboarding |
| P16 retention enforcement | HIGH | Billing |
| P17 rules engine structure | HIGH | Categorization |
| P18 LLM hallucinations | HIGH | Categorization |
| P19 LLM cost | HIGH | Categorization |
| P20 learn from corrections | HIGH | Categorization |
| P21 merchant normalization | HIGH | Categorization |
| P22 NFS-e | CRIT | Billing |
| P23 boleto/PIX recurrence | HIGH | Billing |
| P24 silent payment failure | HIGH | Billing |
| P25 downgrade as freeze | HIGH | Billing |
| P26 IDOR | CRIT | Auth (day 1) |
| P27 admin audit log | HIGH | Auth/Onboarding |
| P28 CPF validation/encryption | HIGH | Auth (day 1) |
| P29 login rate limit | HIGH | Auth (day 1) |
| P30 value before bank connection | HIGH | Onboarding UX |
| P31 dashboard delta | MED | Dashboard |
| P32 paywall tuning | HIGH | Billing |
| P33 notification fatigue | MED | Ingestion |
| P34 recategorize-batch | HIGH | Categorization |
| P35 webhook replay | HIGH | Ingestion |
| P36 observability | HIGH | Ingestion (day 1) |

---

## Sources

- Pluggy API documentation (item states, webhook events) — MEDIUM confidence; verify https://docs.pluggy.ai before implementation
- LGPD Lei nº 13.709/2018 — HIGH confidence (statutory)
- ANPD enforcement patterns — MEDIUM confidence
- BR Open Finance regulatory framework — HIGH confidence
- ASAAS / Iugu NFS-e native support — MEDIUM confidence; verify current offering
- BR personal-finance post-mortems (Guiabolso, Olivia pivot) — MEDIUM

---
*Pitfalls research for: Portal Finance — Brazilian personal finance PWA on Open Finance (Pluggy)*
*Researched: 2026-04-22*
