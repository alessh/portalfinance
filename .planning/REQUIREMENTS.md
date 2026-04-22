# Requirements: Portal Finance

**Defined:** 2026-04-22
**Core Value:** Seeing, without work, where your money actually goes every month.

## v1 Requirements

Requirements for the initial release. Each maps to a roadmap phase.

### Authentication & Identity

- [ ] **AUTH-01**: User can create an account with email, CPF, and password. CPF is validated with check-digit verification on both client and server; invalid or test CPFs are rejected.
- [ ] **AUTH-02**: User can log in with email + password and stay logged in across browser refresh (session-based auth).
- [ ] **AUTH-03**: User can log out from any page and the session is invalidated server-side.
- [ ] **AUTH-04**: User can request a password reset via email link; link is single-use and time-limited.
- [ ] **AUTH-05**: Login is rate-limited (max 5 failed attempts per 15 min) with account lockout and unlock email; password reset is rate-limited (max 3 per hour per email).
- [ ] **AUTH-06**: Passwords are stored as argon2 hashes; CPF is stored AES-256-GCM-encrypted with a SHA-256 hash column used for uniqueness lookups. Neither is ever logged.

### LGPD & Consent

- [x] **LGPD-01
**: Before a Pluggy Connect widget opens, user sees an explicit consent screen listing exactly what data will be collected (transactions, balances, account details) and clicks to grant consent. A `user_consents` row is written (user_id, data_source_type, scope, IP, user_agent, timestamp).
- [ ] **LGPD-02**: User can revoke consent per connection from account settings; revocation writes a new `user_consents` row (append-only audit trail).
- [ ] **LGPD-03**: User can export all personal data (transactions, accounts, categories, corrections) as machine-readable JSON via a DSR request; system responds within the statutory 15-day window.
- [ ] **LGPD-04**: User can request account deletion; deletion is a multi-step workflow that (a) calls Pluggy `DELETE /items/:id` to revoke bank access, (b) removes the user from email lists, (c) anonymizes user identifiers in application logs, (d) soft-deletes DB rows, (e) hard-deletes after a 30-day legal hold. Every step is logged in an immutable `deletion_audit_log`.
- [x] **LGPD-05
**: All personal and financial data (users, accounts, transactions, categories, subscriptions) is stored in Brazilian territory. No service with data-at-rest outside Brazil is used for storage.
- [x] **LGPD-06
**: No personally identifiable information (CPF, transaction descriptions, account numbers, full names) appears in application logs, Sentry payloads, or error traces. A `piiScrubber` utility + Sentry `beforeSend` hook enforce this and are verified with a test capture.

### Open Finance Connection (Pluggy)

- [ ] **CONN-01**: User can open the Pluggy Connect widget after consent and link a bank or credit card account. The connect token is short-lived (30 min) and issued server-side.
- [ ] **CONN-02**: The `item/created` webhook is received, its auth header verified, its `eventId` deduplicated, and an initial-sync job is enqueued — all within 5 seconds (webhook handler returns 200 in < 200 ms after idempotent insert).
- [ ] **CONN-03**: User sees each linked item in "Accounts" with institution name, account name, last-sync timestamp, and a clear health badge (healthy / syncing / needs re-auth / error).
- [ ] **CONN-04**: When an item enters `LOGIN_ERROR` or `WAITING_USER_INPUT`, the UI surfaces a dedicated per-item banner with a "Reconnect" button that re-opens Pluggy Connect for that item; the system does not trigger new syncs on broken items.
- [ ] **CONN-05**: User can disconnect an item; disconnection calls Pluggy `DELETE /items/:id` and marks the item deleted locally. Transactions remain readable (historical), but no further sync is triggered.
- [ ] **CONN-06**: User can trigger a manual sync on a paid-tier item, subject to a per-item cooldown (paid: 30 min; free: manual sync disabled entirely — scheduled only). Over-cooldown requests return a clear "please wait N minutes" message.
- [ ] **CONN-07**: `pluggy_item_id` and any Pluggy tokens are AES-256-GCM-encrypted at rest with the key held outside the database (environment/KMS). Plaintext never appears in DB columns, logs, API responses, or client-visible payloads.

### Transaction Ingestion

- [ ] **TX-01**: Incoming Pluggy transactions are upserted with `UNIQUE (pluggy_transaction_id)` and `ON CONFLICT DO UPDATE`. Partial or overlapping sync windows never create duplicates.
- [ ] **TX-02**: Sync windows always overlap by at least 7 days to catch late-settling transactions; status transitions (PENDING → POSTED) update existing rows in place.
- [ ] **TX-03**: Webhook events (`item/created`, `transactions/created`, `transactions/updated`, `transactions/deleted`, `item/error`) are fully handled; each produces the appropriate worker job. Event IDs are recorded in `webhook_events` with a UNIQUE constraint to guarantee idempotency across retries.
- [ ] **TX-04**: Transfers between a user's own accounts are detected post-ingestion (same |amount|, opposite type, same user, different accounts, within 3 days) and marked `is_transfer = true`; they are excluded from income and expense aggregates and shown in a separate "Transfers" section.
- [ ] **TX-05**: Credit-card fatura payments (checking debit matching the card balance near the due date) are flagged `is_credit_card_payment = true` and excluded from expense aggregates. Individual credit-card transactions remain the expense source of truth.
- [ ] **TX-06**: After downtime, a reconciliation job queries Pluggy for any active item whose `last_synced_at` is older than 12 hours and triggers a sync; an alert fires if items remain stale after the reconciliation window.

### Categorization

- [ ] **CAT-01**: Transactions are categorized automatically after ingestion. The pipeline runs: merchant normalization → per-user rules → shared rules → Pluggy-hint fallback → LLM fallback (gated by budget) → UNCATEGORIZED.
- [ ] **CAT-02**: Merchant-name variants (e.g., "IFOOD *PEDIDO", "APLIC IFOOD", "IFOOD PAGAMENTOS") collapse to the same canonical merchant via a `merchant_aliases` table seeded with known high-frequency BR merchants.
- [ ] **CAT-03**: User can correct a transaction's category. The correction is (a) persisted on the transaction and (b) stored as a new per-user `category_rule` with high priority so future transactions from the same merchant categorize correctly without another LLM call.
- [ ] **CAT-04**: LLM categorization (Gemini Flash 2.0 via Vercel AI SDK) is called only for transactions that match no rule and no usable Pluggy hint. PII (CPF patterns, PIX recipient names) is stripped from the description before the prompt. The response is validated against the closed-enum category taxonomy; invalid responses fall to UNCATEGORIZED and are logged.
- [ ] **CAT-05**: Per-user daily LLM budget is enforced via `llm_usage` table. Free tier has 0 LLM calls; paid tier has a capped daily budget. Over-budget transactions fall to UNCATEGORIZED rather than calling the LLM.
- [ ] **CAT-06**: The system ships with a pt-BR taxonomy of 12–15 top-level categories with subcategories; PIX (incoming salary, outgoing personal, transfer) is handled as first-class patterns, not lumped into "Outros".
- [ ] **CAT-07**: A `recategorize_batch` worker can re-apply the current rules engine to historical transactions (e.g., after a rule change) and update monthly summaries accordingly.

### Monthly Dashboard

- [ ] **DASH-01**: Dashboard shows the current month's total income, total expenses, net result, and a breakdown by top-level category.
- [ ] **DASH-02**: Every headline metric displays the delta vs the previous month as a percentage and/or absolute value, with green/amber/red coloring indicating improvement, moderate increase, or severe overspend.
- [ ] **DASH-03**: User can navigate back to any prior month and see the same view for that period.
- [ ] **DASH-04**: Dashboard reads from pre-aggregated `monthly_summaries` and `category_monthly_totals` tables; no GROUP BY / SUM runs across the `transactions` table at request time. An `aggregation-worker` maintains the summaries after every sync and user correction, debounced per user.
- [ ] **DASH-05**: Transaction list page supports filters by month, account, category, and free-text description search, with pagination.

### Billing & Subscription

- [ ] **BILL-01**: User can subscribe to a paid plan (monthly or annual) via an ASAAS checkout that supports credit card, boleto, and PIX Cobrança. ASAAS issues an NFS-e for every successful charge automatically; the NFS-e number and PDF URL are stored with the billing event.
- [ ] **BILL-02**: `invoice.payment_failed`, `subscription.past_due`, and `subscription.canceled` webhook events are handled. On first failure, an in-app banner and an email are sent within 1 hour with a direct link to update payment; a 3–5 day grace period runs before any access is revoked.
- [ ] **BILL-03**: User can cancel or change plan from an in-app subscription management page. Cancellation takes effect at the end of the current period; the UI clearly shows the effective date.
- [ ] **BILL-04**: Free tier is enforced server-side: maximum 1 connected account, last 3 months of history visible, manual sync disabled. When a paid user cancels, excess accounts are FROZEN (hidden, read-only), never hard-deleted; they are restored immediately on resubscription.
- [ ] **BILL-05**: All billing events (paid, failed, canceled, refunded, NFS-e emitted) are logged in `billing_events` with timestamps and provider references.

### Security & Authorization

- [ ] **SEC-01**: Every API endpoint and server-rendered page that reads user data filters by the session user's `user_id`. Accessing another user's transaction, account, or connection returns 404. Integration tests verify that user B cannot retrieve user A's data via any endpoint.
- [ ] **SEC-02**: Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` where possible); session tokens are rotated on privilege changes.
- [ ] **SEC-03**: Admin or support access to user data is gated behind an elevated session (re-authentication required) and every access is written to an immutable `admin_access_log`; admin views show summaries, not raw transaction descriptions.

### Platform & Distribution

- [ ] **APP-01**: The web application is responsive and usable on mobile browsers (iOS Safari, Android Chrome) without feature degradation.
- [ ] **APP-02**: The application is installable as a PWA (Serwist service worker, valid manifest, offline shell for critical pages like dashboard); push notifications are not in scope for v1.

### Operational Readiness

- [ ] **OPS-01**: Structured JSON logging from day one with user IDs hashed, no PII; log retention capped at 30 days with automatic expiration. Sentry EU region (`de.sentry.io`) captures errors with `beforeSend` PII scrubbing.
- [ ] **OPS-02**: Key metrics are observable before public launch: sync success rate, sync duration p50/p95, categorization match rate (rules vs LLM vs uncategorized), LLM cost per day, webhook processing lag. Alerts fire on threshold breach (sync failure >5%, LLM cost/day above limit, webhook 5xx rate >1%).
- [ ] **OPS-03**: A scheduled `retention-worker` soft-deletes then hard-deletes data for closed accounts past the privacy-policy retention window, with a 7-day warning email before hard deletion.
- [ ] **OPS-04**: Sandbox and production Pluggy credentials are distinct and cannot be confused. A runtime assertion throws on startup if `NODE_ENV=production` and a sandbox credential is detected.

## v1.x Requirements (post-launch, data-dependent)

Deferred because they require 2–3 months of accumulated data or a validated categorization baseline, but the v1 data pipeline must make them possible without a schema break.

### Budgeting

- **BUDG-01**: User can set a monthly budget per top-level category and see progress bars.
- **BUDG-02**: User is alerted when a category is projected to exceed budget before month-end.

### Insights & Alerts

- **INSG-01**: Recurring bills are auto-detected and shown as an expected upcoming expense calendar.
- **INSG-02**: Unusual transactions (>2× the typical amount in that category) are surfaced as anomaly alerts.
- **INSG-03**: 13º salário inflow is auto-detected and surfaced as a distinct annual event.
- **INSG-04**: Parcelamento (installment purchases on credit card) is grouped as a single logical purchase with installment schedule.

### Social / Auth expansion

- **AUTH-EXT-01**: Google OAuth sign-in as a signup/login alternative.
- **AUTH-EXT-02**: Free-tier display advertising (ad-only for free users, ad-free for paid).

## v2 Requirements (marketplace era)

- **GOAL-01..N**: Metas e objetivos personalizados (targets, progress, projected date).
- **PAT-01..N**: Patrimônio — integrated view of investments, real estate, liabilities, evolution over time.
- **MKT-01..N**: Marketplace of financial products (investments, credit, insurance, pension) with AI-recommended offers driven by the user's real transaction history.
- **AI-01..N**: AI assistant / chat over real data with per-query LLM budget and audited prompt history.
- **MOB-01..N**: Native mobile apps (iOS, Android) built on shared business logic.
- **SOC-01..N**: Shared / family accounts and joint budgets.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep and to capture the rationale.

| Feature | Reason |
|---------|--------|
| Manual transaction entry | Anti-feature — attracts the wrong persona and contradicts the "see without work" core value |
| Hard-deleting data on downgrade | Trust-destroying anti-pattern; downgrade always freezes, never deletes |
| Direct bank integration as a regulated Iniciadora/Receptora (Bacen) | 6–12 month compliance effort; out of scope for pre-seed. Pluggy is the layer |
| Multi-currency / multi-country | v1 is Brazil / BRL only |
| Real-time streaming updates | Unnecessary complexity; periodic sync + webhook-driven incrementals are sufficient |
| Video / voice onboarding | Not core to the value proposition |
| OAuth (Google/Apple) sign-in at v1 | Deferred to v1.x — email + CPF + password is adequate for launch |
| Native iOS / Android apps at v1 | PWA-first; native deferred to V2 |
| Push notifications at v1 | Email is sufficient for re-auth and billing alerts in v1 |
| Goals, marketplace, AI assistant, patrimony view | Deferred to V2+ — v1 validates the subscription and the categorization differentiator |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| AUTH-04 | Phase 1 | Pending |
| AUTH-05 | Phase 1 | Pending |
| AUTH-06 | Phase 1 | Pending |
| LGPD-01 | Phase 1 | Pending |
| LGPD-02 | Phase 2 | Pending |
| LGPD-03 | Phase 6 | Pending |
| LGPD-04 | Phase 6 | Pending |
| LGPD-05 | Phase 1 | Pending |
| LGPD-06 | Phase 1 | Pending |
| CONN-01 | Phase 2 | Pending |
| CONN-02 | Phase 2 | Pending |
| CONN-03 | Phase 2 | Pending |
| CONN-04 | Phase 2 | Pending |
| CONN-05 | Phase 2 | Pending |
| CONN-06 | Phase 2 | Pending |
| CONN-07 | Phase 2 | Pending |
| TX-01 | Phase 2 | Pending |
| TX-02 | Phase 2 | Pending |
| TX-03 | Phase 2 | Pending |
| TX-04 | Phase 2 | Pending |
| TX-05 | Phase 2 | Pending |
| TX-06 | Phase 2 | Pending |
| CAT-01 | Phase 3 | Pending |
| CAT-02 | Phase 3 | Pending |
| CAT-03 | Phase 3 | Pending |
| CAT-04 | Phase 3 | Pending |
| CAT-05 | Phase 3 | Pending |
| CAT-06 | Phase 3 | Pending |
| CAT-07 | Phase 3 | Pending |
| DASH-01 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |
| DASH-03 | Phase 4 | Pending |
| DASH-04 | Phase 4 | Pending |
| DASH-05 | Phase 4 | Pending |
| BILL-01 | Phase 5 | Pending |
| BILL-02 | Phase 5 | Pending |
| BILL-03 | Phase 5 | Pending |
| BILL-04 | Phase 5 | Pending |
| BILL-05 | Phase 5 | Pending |
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| SEC-03 | Phase 6 | Pending |
| APP-01 | Phase 4 | Pending |
| APP-02 | Phase 4 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 6 | Pending |
| OPS-03 | Phase 6 | Pending |
| OPS-04 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 51 total
- Mapped to phases: 51
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-22*
*Last updated: 2026-04-22 after initial definition*
