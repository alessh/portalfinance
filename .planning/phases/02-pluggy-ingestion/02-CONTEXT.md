# Phase 2: Pluggy Ingestion - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

End-to-end Pluggy ingestion: consent → connect (with CPF capture) → webhook receiver → sync workers → transaction dedup → transfer & fatura detection → re-auth flow → raw transaction list UI + item health surfaces + manual-sync cooldown.

**Phase 2 ships:**
- Consent-gated `/connect` route + `react-pluggy-connect` widget + connect-token endpoint.
- Webhook receiver `/api/webhooks/pluggy` with custom-header auth + idempotent `webhook_events`.
- pg-boss workers: `pluggy-sync`, `transfer-detector`, `fatura-detector`, `re-auth-notifier`, `pluggy-reconcile`.
- Three new schema aggregates: `pluggy_items`, `accounts`, `transactions`.
- AES-256-GCM encryption of `pluggy_item_id` (reuses Phase 1 `lib/crypto.ts`).
- Raw transaction list at `/transactions` (date-grouped, no categorization), per-item health page at `/settings/connections`, persistent global re-auth banner.
- Disconnect flow (Pluggy `DELETE /items/:id` + per-item revocation row in `user_consents`).
- Manual-sync button with 30-min per-item cooldown (paid only); free-tier hard-block on 2nd item.
- Audit log extended with item lifecycle events.

**Phase 2 does NOT ship** (deferred to later phases):
- Categorization (Phase 3) — `transactions.category_id` is nullable text slug in Phase 2; Phase 3 introduces `categories` table + FK migration.
- Aggregations / dashboard / monthly summaries (Phase 4).
- Billing, paywall enforcement, real free-tier paywall modal (Phase 5) — Phase 2 ships paywall stubs that link to `/settings/billing`.
- Full deletion workflow / DSR execution (Phase 6) — Phase 2 ships disconnect (stop sync), not data deletion.

**Requirements in scope:** LGPD-02, CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, CONN-06, CONN-07, TX-01, TX-02, TX-03, TX-04, TX-05, TX-06.

</domain>

<decisions>
## Implementation Decisions

### Connect & Consent Flow UX

- **D-01:** Canonical entry point is **`/connect`** (dedicated route). Demo-dashboard CTA, Settings > Connections, and re-auth emails all link here. No modal-over-page entry; a stable URL is needed for email deep-linking.
- **D-02:** **CPF is captured inline on the consent screen**, atomic with the consent grant. One server submission writes the `user_consents` row, validates CPF (`@brazilian-utils/brazilian-utils` check-digits), encrypts via `lib/crypto.ts` AES-256-GCM, sets `users.cpf_hash` + `users.cpf_enc`, then returns a fresh Pluggy connect token. CPF is not collected before consent (LGPD: legal basis precedes data collection).
- **D-03:** Post-connect destination is **`/connect/success`** showing "Sincronizando..." with progress steps (Connected → Loading accounts → Loading transactions). Server-side polling via `/api/sync-status` every **2 seconds** for up to **60 seconds** (honors Phase 2 Success Criterion #1). Auto-redirects to `/transactions` on first transactions/created webhook OR after 60s timeout (partial data is fine; sync continues in background).
- **D-04:** Per-item revocation lives at **Settings > Connections** with a "Disconnect" button + 2-step typed-confirmation modal. Modal copy spells out: (a) Pluggy `DELETE /items/:id` is called, (b) sync stops, (c) historical transactions remain readable, (d) a new `user_consents` row is appended (`action='REVOKED'`, scope of original connect). User must type `DISCONNECT` to confirm. No 1-click revoke (LGPD revocations are append-only and cannot be undone — reconnect is a fresh consent row).
- **D-05:** Pluggy widget handles the **connector picker** (we issue a connect token without a preselected `connectorId`). Zero connector-list maintenance on our side; Pluggy's connector availability changes are absorbed automatically.
- **D-06:** CPF check-digit validation is **client-side first, then server-side**. On invalid: inline error `CPF inválido`, **no DB writes**, no consent row, no token issued. User retries inline.
- **D-07:** Sync trigger on first connect: the `react-pluggy-connect` `onSuccess` callback **POSTs to `/api/pluggy/items`**, which (a) creates the `pluggy_items` row with the encrypted Pluggy `itemId`, (b) writes the per-connector consent row (D-08 step 2), (c) immediately enqueues `pluggy-sync` for that user. The `item/created` webhook is treated as an idempotent confirmation/status updater — never the trigger for first sync. (Pluggy webhook retries can take up to 1h; we don't make the user wait.)
- **D-08:** Per-connect consent recording is **two append-only rows**:
  1. Pre-widget: `user_consents` insert with `scope='PLUGGY_CONNECT_PENDING'`, `action='GRANTED'`, IP, UA, timestamp, `consent_version_hash`.
  2. Post-widget (in `/api/pluggy/items` handler, atomic with `pluggy_items` insert): a second `user_consents` row with `scope='PLUGGY_CONNECTOR:{connectorId}'` (e.g., `PLUGGY_CONNECTOR:itau-banking`), `action='GRANTED'`, same metadata.
  Honors P11 (per-data-source consent) literally; the audit trail proves the user consented before AND after seeing which institution they were connecting.
- **D-09:** **One Pluggy item produces N accounts**, all auto-created and visible. Free-tier "1 connected account" (BILL-04 wording) is interpreted as **1 ITEM**; sub-accounts of that item (checking, savings, credit card on the same login) all show. Aligns with how users count connections ("I connected my Itau" = one connection, multiple sub-accounts).
- **D-10:** `consent_version_hash` for Pluggy connects = `SHA-256(privacy_policy.md + tos.md + 'pluggy_connect_v1')`. Constant `'pluggy_connect_v1'` is bumped to `pluggy_connect_v2` whenever the Pluggy disclosure copy changes. Phase 1's existing `consent_version` helper is extended with a scope parameter.
- **D-11:** **All MFA stays inside the Pluggy widget iframe** — both initial connect AND re-auth via update mode (`itemId` in connect-token request). We never POST MFA tokens to Pluggy directly; the widget handles WAITING_USER_INPUT, executions polling, and onSuccess timing. Reconnect uses the same widget component with `reconnectItemId={pluggy_items.id}` prop.
- **D-12:** Reconnect deep-link from emails/banners is **`/connect?reconnect={pluggy_items.id}`** — internal UUID, NOT the Pluggy item id. URL is session-protected; unauthenticated visit redirects to `/login?next=/connect?reconnect=...`. After login, the server issues a **fresh 30-min Pluggy connect token in update mode** at click time (not embedded in the email). Email links never expire on the email side; auth + token freshness gate the action.
- **D-13:** **`audit_log` extended** with Phase 2 events (extends Phase 1 D-19 catalogue):
  - `item_connected`, `item_disconnected`, `item_reauth_started`, `item_reauth_succeeded`, `item_reauth_failed`
  - `manual_sync_triggered` (with `cooldown_bypassed: bool` flag — bypass=true on reconnect-triggered sync)
  - `transfer_detected`, `fatura_detected` (per-tx provenance for LGPD-04 disputes; tx-level proof of detector decisions)
- **D-14:** Consent disclosure copy is **plain pt-BR friendly voice**, with a collapsible "Detalhes legais" link that expands to LGPD Arts. 7º, 8º, 9º citations + full data-handling description. Body text on the screen example: *"Você está autorizando a Portal Finance a receber suas transações, saldos e detalhes da conta do seu banco através da Pluggy. Você pode revogar a qualquer momento em Configurações > Conexões."* Plaintext alternate body required in any related emails.

### Tx List + Item Health & Reconnect Surfaces

- **D-15:** Raw transaction list shape on `/transactions`: **grouped by date with sticky headers** (`Hoje`, `Ontem`, `15 abr`). Dense rows: amount (+green / -red, BR formatting `R$ 1.234,56`), description (raw, see D-19), account name as small inline metadata. **No category column in Phase 2** (Phase 3 adds it). Compact mobile-first layout (~20 rows on a phone screen). Mirrors Nubank/Mercado Pago feel.
- **D-16:** Phase 2 filters on `/transactions`: **month picker + account filter only**. Top of page: month picker (current / prev-1 / prev-2 / older — older months gated for free tier per D-26) + account dropdown (All / Itau Checking / Itau Credit Card / ...). **No free-text search**, **no category filter** (no categories yet) — both fold into Phase 4 with DASH-05.
- **D-17:** Item-health view lives at **`/settings/connections`** (single canonical page). Per-item card: institution logo (Pluggy provides), institution name, status pill, "Conectado há X dias", collapsible sub-account list with balance + last-synced, action buttons (Reconnect when broken / Manual sync when paid+healthy / Disconnect always). No separate `/accounts` page in Phase 2; can be added in Phase 4 if needed.
- **D-18:** Status taxonomy + reconnect banner placement: **per-item pill badge + persistent global banner** when ≥1 item needs re-auth.
  - Pill colors: `UPDATED`/healthy=green, `UPDATING`=blue (pulsing), `LOGIN_ERROR`/`OUTDATED`=amber/red, `WAITING_USER_INPUT`=amber. Maps directly to Pluggy's item status enum (UPDATING / LOGIN_ERROR / OUTDATED / WAITING_USER_INPUT / UPDATED).
  - Global banner: persistent on every authenticated page when any item is in LOGIN_ERROR / WAITING_USER_INPUT / OUTDATED-with-error. CTA "Reconectar {Banco}" deep-links to `/connect?reconnect={item_uuid}`. Honors CONN-04 + ensures users notice broken sync from any page.
- **D-19:** Description text in `/transactions` is the **raw `description` from Pluggy, no transformation**. Phase 3 will normalize merchants and replace this column with normalized merchant name. Phase 2's job is trustworthy raw data only — never use Pluggy's `merchant.name` (P6 — Pluggy merchants are unreliable, especially for PIX).
- **D-20:** **Account balance shown** per sub-account on the `/settings/connections` card row (`Saldo: R$ 1.234,56`). Useful trust signal that sync is working; no toggle / hide-balance UI in Phase 2.
- **D-21:** Syncing UI: **pulsing blue dot + "Sincronizando..." text** when `pluggy_items.status='UPDATING'`. CSS pulse animation, no spinner (spinners imply user wait). Status flips to "healthy" when item.status=UPDATED webhook arrives. No phase breakdown of `executionStatus` in Phase 2 (could revisit if users complain about long syncs).
- **D-22:** **Pagination** on `/transactions`: server-paginated, **50 transactions per page**, "Carregar mais" button at the bottom. No infinite scroll (Phase 4 dashboard may add `useInfiniteQuery` if needed). Predictable, accessible, no virtualization required.

### Pending vs Posted, Empty States, Last-Synced Format

- **D-23:** **Pending and posted transactions both shown** in the same list. Pending get a small `Pendente` chip inline. Pending excluded from any totals (Phase 2 has no totals; Phase 4 dashboard will exclude via `status='POSTED'` filter). On next sync, Pluggy webhook `transactions/updated` flips status PENDING→POSTED in place via `ON CONFLICT DO UPDATE` (TX-02).
- **D-24:** **Three distinct empty states** on `/transactions` with specific CTAs:
  - (a) **No items connected:** "Conecte seu primeiro banco" + button → `/connect`.
  - (b) **Items connected, currently syncing:** "Buscando suas transações..." + spinner + last-sync timestamp + "Voltar para o dashboard" button.
  - (c) **Items connected, sync done, zero tx in selected month:** "Sem transações em {Mês}" + "Mudar mês" button (re-opens month picker).
- **D-25:** Last-synced relative time format on `/settings/connections`: **relative inline + absolute on hover/long-press**. Example: `sincronizado há 12 min` with tooltip `15 abr 2026 14:23 BRT`. Mobile long-press surfaces the absolute timestamp. Uses `formatRelative` from date-fns with pt-BR locale.

### Sync UX — Manual Button, Cooldown, History Depth

- **D-26:** **Initial sync depth = 12 months for everyone** (max Pluggy allows). All transactions stored regardless of tier. Free-tier visible window = 3 months (BILL-04) is enforced at **the read layer**, not at the sync layer. On upgrade, full history is instantly visible (no re-sync needed). Sets up Phase 4 dashboard with rich pre-aggregated data.
- **D-27:** Free-tier 3-month visibility on `/transactions`: **all months shown in the picker, but selecting an older month renders a paywall card** with "Histórico completo disponível no plano pago" + upgrade CTA, with the actual transactions blurred behind it. Drives upgrade conversion. Phase 5 wires the real paywall modal; Phase 2 ships a paywall stub linking to `/settings/billing` (route to be created in Phase 5).
- **D-28:** **Paid-tier manual sync button**: always visible on `/settings/connections` per item. Active state: label `Sincronizar agora`. Cooldown state: disabled with live countdown (`Aguarde 12 min`, updates every minute via client-side ticker). Tooltip: *"A Pluggy permite uma sincronização manual a cada 30 minutos para evitar sobrecarga."* Cooldown enforced server-side on `POST /api/pluggy/items/:id/sync` against `pluggy_items.last_synced_at`.
- **D-29:** **Free-tier sync button** is shown as an upgrade-prompt: same button position with label `Sincronizar agora` but click → paywall modal. Phase 2 ships modal stub linking to `/settings/billing`. Supports BILL-04 enforcement AND drives upgrade conversion. Free-tier scheduled sync relies on **Pluggy's daily auto-sync** (Pluggy syncs healthy items once/day server-side); we add no additional cron for free users — TX-06 reconciliation handles stale items uniformly across tiers.
- **D-30:** **Reconnect always triggers an immediate sync, ignoring cooldown.** When the `item/login_succeeded` webhook arrives (after a successful re-auth), the worker enqueues `pluggy-sync` directly with `cooldown_bypassed=true`. Logged in `audit_log` as `manual_sync_triggered` with the bypass flag. User sees "Sincronizando..." in the global banner, which auto-dismisses on `item.status='UPDATED'`.

### Transfer/Fatura UX + Re-auth Email Cadence

- **D-31:** Detected transfers and fatura payments **stay inline in the main feed** with a small chip (`Transferência` / `Pagamento de fatura`). Phase 2 has no totals; Phase 4 dashboard naturally excludes them via the boolean flags. Builds trust ("system noticed I had a transfer").
- **D-32:** **No flag-override UI in Phase 2.** False-positive correction (un-flag a transfer that was actually a real expense) is **deferred to Phase 3** and folded into CAT-03's per-tx correction interaction. Phase 2 ships detection + chip only.
- **D-33:** **Deterministic transfer detection — no confidence score.** Heuristic: same `|amount|`, opposite `type` (one DEBIT + one CREDIT), same `user_id`, two different `account_id`s under the same user, within 3 days posted-at delta. All four match → flag both rows with `is_transfer=true` and link them via `transfer_pair_id`. Any mismatch → no flag. P7-aligned; defer ML/scoring to v1.x.
- **D-34:** **Re-auth email send timing**: on first `item/error` per item, instantly enqueue the email (worker `re-auth-notifier`); 24-hour debounce window for that item — additional `item/error` events from Pluggy retries within 24h do NOT trigger another email. After 24h with no resolution, send a follow-up email. After 7 days with no resolution, stop sending; banner persists indefinitely. Pluggy retries 9 times in 2h (3 immediate + 3 at 1h + 3 at 2h) — debounce prevents email storms from retry chains.
- **D-35:** **Re-auth email content**:
  - Subject: `Reconecte seu {Institution Name}` (institution name from `pluggy_items.institution_name`).
  - Body (React Email template): institution name, last successful sync date, single CTA button → `/connect?reconnect={item_uuid}`, "Responda este email para suporte" footer.
  - Plaintext alternate body required (Phase 1 plan 01-05 lockdown).
  - Sender: `no-reply@portalfinance.app` (Phase 1 D-11). SES sa-east-1, ConfigurationSet attached (Phase 1 plan 01-05).
- **D-36:** **Re-auth banner is persistent and not dismissable**, survives logout/login. Stays visible on every authenticated page until `item.status` flips back to UPDATED via `item/login_succeeded` webhook. Same friction-level as Phase 1's email-verification nag banner; financial data freshness is a stronger trust signal than email verification, so warrants the same persistence.
- **D-37:** **Banner stack ordering** when both Phase 1 email-verification banner and Phase 2 re-auth banner are active: **both stack vertically, re-auth on top** (more urgent — actionable revenue/data risk). The shared `<BannerStack>` component (created in Phase 1, refactored if needed in Phase 2) supports a `priority` prop; re-auth banners have higher priority than verification.
- **D-38:** **Reconciliation worker (TX-06)** runs as an **hourly pg-boss cron**. Query: active items where `last_synced_at < now() - interval '12 hours'` AND `status NOT IN ('LOGIN_ERROR','WAITING_USER_INPUT')`. For each: enqueue `pluggy-sync` (rate-limited by per-user singleton key D-41 + Pluggy 20/min PATCH budget). Alert (Sentry warning + structured log) if >5 items remain stale after the run completes. Cron job: `pluggy.reconcile.stale-items` at `:00` every hour BRT.

### Pluggy SDK + Worker Plumbing

- **D-39:** **Server SDK = `pluggy-sdk@0.85`** (official Node SDK). **Client SDK = `react-pluggy-connect@2.12`** (official widget wrapper). Both typed; `pluggy-sdk` handles auth, rate-limit headers, and retries. We wrap it in a thin `PluggyService` (`src/services/PluggyService.ts`) for testability + per-call audit logging + error normalization.
- **D-40:** **Encryption surface = `pluggy_item_id` only at rest** (matches CONN-07 + P4). `lib/crypto.ts` (Phase 1) encrypts on write to `pluggy_items.pluggy_item_id_enc`, decrypts only inside `PluggyService` calls. `PLUGGY_CLIENT_ID` + `PLUGGY_CLIENT_SECRET` are AWS SSM SecureStrings (already provisioned pattern from Phase 1 SES). Pluggy does NOT issue per-item access tokens — `clientId` + `clientSecret` are global; `itemId` identifies the connection. **Webhook payloads stored in `webhook_events.payload` JSONB are NOT encrypted** — they are short-lived (we process and stop relying on them); if encryption needed later, revisit in Phase 6 hardening.
- **D-41:** **pg-boss singleton key = per user**: queue `pluggy.sync` with `singletonKey = user_id`, `singletonHours = 0` (in-flight only). While a user has any sync running, additional sync requests for the same user de-dupe during execution. Honors per-user concurrency=1 from ARCHITECTURE.md and prevents Pluggy rate-limit storms (PATCH /items global cap = 20/min).
- **D-42:** **Webhook auth = custom shared header** (Pluggy spec). Header value (e.g., `X-Pluggy-Signature`) stored as **`PLUGGY_WEBHOOK_SECRET` in env** (AWS SSM SecureString). Validated by `lib/env.ts` at boot. Webhook receiver compares the inbound header against the env value (constant-time compare via `crypto.timingSafeEqual`). **Plus** Cloudflare WAF rule rejects requests not from Pluggy's IP `177.71.238.212` at the edge (defense in depth — added to Cloudflare config in Phase 2 plan).

### Schema Decisions for Planner

- **D-43:** **`pluggy_items` table** (new):
  - `id UUID PK DEFAULT gen_random_uuid()`
  - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `pluggy_item_id_enc bytea NOT NULL` (AES-256-GCM ciphertext)
  - `pluggy_item_id_hash bytea NOT NULL` (SHA-256 for uniqueness lookups; same pattern as `users.cpf_hash`)
  - `connector_id text NOT NULL`
  - `institution_name text NOT NULL`
  - `institution_logo_url text`
  - `status item_status_enum NOT NULL` (Postgres enum: `UPDATING | LOGIN_ERROR | OUTDATED | WAITING_USER_INPUT | UPDATED`)
  - `execution_status text` (Pluggy's executionStatus value, free text — too many values to enum)
  - `last_synced_at timestamptz`
  - `last_error_at timestamptz`
  - `created_at timestamptz DEFAULT now() NOT NULL`
  - `updated_at timestamptz DEFAULT now() NOT NULL`
  - **Unique:** `UNIQUE(user_id, pluggy_item_id_hash)` — prevents same Pluggy item being connected twice by same user.
  - **Index:** `(user_id, status)` for fast "items needing reconnect" + "stale items" queries.
- **D-44:** **`accounts` table** (new):
  - `id UUID PK DEFAULT gen_random_uuid()`
  - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` (duplicated for fast IDOR checks per SEC-01 / P26)
  - `pluggy_item_id UUID NOT NULL REFERENCES pluggy_items(id) ON DELETE CASCADE`
  - `pluggy_account_id text NOT NULL`
  - `type account_type_enum NOT NULL` (`CHECKING | SAVINGS | CREDIT_CARD | LOAN | INVESTMENT | OTHER`)
  - `subtype text` (Pluggy's subtype, free text)
  - `name text NOT NULL`
  - `currency text NOT NULL` (ISO-4217, normally `BRL`)
  - `balance numeric(15,2) NOT NULL`
  - `credit_limit numeric(15,2)` (nullable; only for credit cards)
  - `status account_status_enum NOT NULL DEFAULT 'ACTIVE'` (`ACTIVE | FROZEN | DELETED`) — `FROZEN` shipped in Phase 2 to support Phase 5's BILL-04 downgrade-as-freeze without future migration.
  - `owner text` (account holder name from Pluggy)
  - `created_at timestamptz DEFAULT now() NOT NULL`
  - `updated_at timestamptz DEFAULT now() NOT NULL`
  - **Unique:** `UNIQUE(pluggy_account_id)`.
  - **Index:** `(user_id, status)` for fast active-accounts queries.
- **D-45:** **`transactions` table** (new):
  - `id UUID PK DEFAULT gen_random_uuid()`
  - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` (duplicated for IDOR)
  - `account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE`
  - `pluggy_transaction_id text NOT NULL`
  - `type tx_type_enum NOT NULL` (`DEBIT | CREDIT`)
  - `amount numeric(15,2) NOT NULL` (positive number; sign inferred from `type`)
  - `currency text NOT NULL`
  - `description text NOT NULL` (raw Pluggy description; Phase 3 will populate normalized merchant elsewhere)
  - `description_raw text` (Pluggy's `descriptionRaw` field, less cleaned)
  - `merchant_name text` (Pluggy's merchant.name; **NOT trusted** per D-19, stored for Phase 3 reference only)
  - `merchant_cnpj text` (Pluggy's merchant.cnpj when present)
  - `posted_at timestamptz NOT NULL`
  - `status tx_status_enum NOT NULL` (`PENDING | POSTED`)
  - `category_id text` (nullable text slug in Phase 2; Phase 3 introduces `categories` table + migrates this column to `UUID REFERENCES categories(id)`)
  - `is_transfer boolean NOT NULL DEFAULT false`
  - `is_credit_card_payment boolean NOT NULL DEFAULT false`
  - `transfer_pair_id UUID REFERENCES transactions(id)` (nullable self-FK; both legs of a transfer link to each other; constraint: NULL when `is_transfer=false`)
  - `pluggy_category text` (Pluggy's hint, for Phase 3 weak-signal use only — P6)
  - `payment_method text` (e.g., `PIX`, `BOLETO`, `CARD`)
  - `raw_payload jsonb NOT NULL` (full Pluggy transaction for replay/debug)
  - `created_at timestamptz DEFAULT now() NOT NULL`
  - `updated_at timestamptz DEFAULT now() NOT NULL`
  - **Unique:** `UNIQUE(pluggy_transaction_id)` — non-negotiable (TX-01).
  - **Indexes:**
    - `(user_id, posted_at DESC)` — `/transactions` list query.
    - `(account_id, posted_at DESC)` — per-account history.
    - **Partial index** `(user_id, posted_at DESC) WHERE is_transfer=false AND is_credit_card_payment=false` — Phase 4 dashboard pre-aggregation hot path. (Phase 4 uses pre-aggregated tables per DASH-04, but partial index helps incremental aggregation.)
- **D-46:** **`category_id` defers FK to Phase 3.** Phase 2 stores it as nullable `text` slug. Phase 3 migration:
  1. Create `categories` table with seed taxonomy.
  2. Add new column `category_id_uuid UUID REFERENCES categories(id)`.
  3. Backfill via slug lookup.
  4. Drop old text column, rename new column to `category_id`.
  Phase 2 doesn't bake Phase 3's schema into its scope.

### Observability Metrics

- **D-47:** Phase 2 instrumentation = **pino structured logs at every state transition + Sentry custom transactions for each sync**, OTel deferred to Phase 6.
  - **Pino logs (info-level)** emitted by webhook receivers and workers:
    - `webhook_received` (source, event_type, event_id; payload NEVER logged in plaintext per P13/D-18)
    - `sync_started` (user_id_hashed, item_id_hashed, trigger='manual'|'webhook'|'reconcile'|'reconnect')
    - `sync_completed` (duration_ms, transactions_added, transactions_updated, transactions_deleted)
    - `sync_failed` (reason: HTTP status, Pluggy error code if any; **never** the raw Pluggy response body which may contain PII)
    - `transfer_detected` (count, user_id_hashed)
    - `fatura_detected` (count, user_id_hashed)
    - `reconnect_email_sent` (item_id_hashed, debounce_seconds)
    - `pluggy_rate_limited` (endpoint, retry_after_seconds) — for the 20/min PATCH bucket alarm
  - **Sentry custom transactions** wrap the `pluggy-sync` worker call: `Sentry.startTransaction({ op: 'pluggy.sync', name: 'pluggy-sync-worker' })`. Tags: `tier`, `connector_id`. Sensitive fields scrubbed via Phase 1 `beforeSend` hook.
  - **OTel metrics, dashboards, and alert thresholds** are deferred to Phase 6 (OPS-02). Phase 2 lays the log substrate; Phase 6 wires CloudWatch Insights queries + alarms.

### Sandbox + Free-Tier 2nd-Item Enforcement

- **D-48:** **Test strategy = unit-mocked + nightly integration**. Unit tests mock `PluggyService` entirely via vitest mocks. Integration tests run against Pluggy sandbox using `PLUGGY_SANDBOX_CLIENT_ID/SECRET` env vars and a fixture user (`test+pluggy@portalfinance.app`). Sandbox username variations exercise state transitions (`user-ok` → SUCCESS, `user-locked` → ACCOUNT_LOCKED, etc.). 30-day sandbox-item expiry handled via a `beforeAll` retry guard that recreates fixtures on `INVALID_PARAMETER`. CI runs unit tests on every push; integration suite runs nightly via GitHub Actions cron (or worker run job in Copilot).
- **D-49:** **Free user's 2nd connect attempt is hard-blocked** at the entry point. `/connect` checks `subscription_tier='free'` AND `count(pluggy_items WHERE user_id=$session AND status NOT IN ('DELETED'))>=1` → renders paywall modal **before issuing a connect token**, widget never opens, no Pluggy item created. Modal CTA links to `/settings/billing` (route stub in Phase 2; real subscription page in Phase 5). Saves Pluggy API spend, prevents orphan items, sets up Phase 5's real paywall surface cleanly.

### Claude's Discretion (not explicitly asked)

- **PluggyService class shape:** `src/services/PluggyService.ts` exposes `createConnectToken({ userId, reconnectItemId? })`, `getItem(itemId)`, `listAccounts(itemId)`, `listTransactions(itemId, accountId, { from, to, cursor? })`, `deleteItem(itemId)`. Internally wraps `pluggy-sdk`; never exposes `itemId` in errors; logs every call with hashed IDs.
- **Webhook receiver structure:** `src/app/api/webhooks/pluggy/route.ts`: validates `X-Pluggy-Signature` header (constant-time compare), inserts `webhook_events(source='PLUGGY', event_type, event_id, payload)` with `ON CONFLICT DO NOTHING RETURNING id`, returns 200 in <200ms; if RETURNING set is non-empty, enqueues the matching pg-boss job. **No business logic in the route handler** (P3, P5).
- **Webhook event → worker mapping:**
  - `item/created`, `item/updated`, `item/login_succeeded` → `pluggy-sync` (incremental).
  - `item/error`, `item/waiting_user_input` → `re-auth-notifier`.
  - `item/deleted` → no-op (we initiate deletes; the webhook is confirmation).
  - `transactions/created`, `transactions/updated` → enqueued for the same `pluggy-sync` worker which fetches and upserts (we do not trust webhook payload for transaction data; we fetch via `listTransactions` for fresh state).
  - `transactions/deleted` → `pluggy-sync` worker deletes by `pluggy_transaction_id` (rare).
  - `connector/status_updated` → updates a `connectors` cache table if we ever build one; Phase 2 ignores this event.
- **Cursor pagination:** `listTransactions` uses Pluggy's cursor-based endpoint (`transactions-list-by-cursor`); the worker walks pages until exhausted, with a 12-month posted-at lower bound on the first page request. Cursor is opaque; we don't persist it (sync windows are computed from `last_synced_at - 7 days`).
- **Sync window logic:** initial sync = full 12 months; incremental sync = `last_synced_at - 7 days` to now (TX-02 overlap requirement); reconnect sync = full 12 months again (data may have shifted).
- **`subscription_tier` default flips for Phase 2 free-tier UX:** Phase 1 D-default-paid stands; Phase 2 ALSO needs to read tier on every `/connect` and `/api/pluggy/items/:id/sync` call. Tier read from `users.subscription_tier`; cached at session-creation time + invalidated on Phase 5 webhook events (no cache invalidation needed in Phase 2 since tier is static for the test population).
- **CPF NOT-NULL migration:** Phase 2's first DB migration adds NOT NULL to `users.cpf_hash` + `users.cpf_enc` (Phase 1 D-04 schema implication). Migration runs in two steps: (1) backfill any existing pre-Phase-2 test users via a manual data fix or controlled deletion, (2) `ALTER COLUMN ... SET NOT NULL`. Production has zero real users at Phase 2 start (per STATE.md: 14 plans complete, no production users), so backfill is trivial.
- **`audit_log` schema unchanged**: Phase 1 already supports new event types via `event_type text`; Phase 2 just emits new strings.
- **No new email templates beyond `re-auth-notifier`**: Phase 1 D-15 SES bounce handler stays as-is. Phase 2 adds one new React Email template `ReAuthRequired.tsx` + plaintext alternate.
- **Frontend state management**: existing TanStack Query v5 setup (Phase 1) used for `/transactions`, `/settings/connections`, sync-status polling. No new global state library.
- **Form validation on consent screen**: existing React Hook Form + Zod (Phase 1) used for the inline CPF field. Reuse `cpf` validator from `lib/cpf.ts` (Phase 1).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (always load)

- `.planning/PROJECT.md` — vision, BR-residency constraint, Pluggy as locked Open Finance layer, free-tier shape (1 account / 3 mo / no manual sync).
- `.planning/REQUIREMENTS.md` § Open Finance Connection (CONN-01..07), § Transaction Ingestion (TX-01..06), § LGPD & Consent (LGPD-02), § Security & Authorization (SEC-01).
- `.planning/ROADMAP.md` § Phase 2 — goal, depends-on (Phase 1), success criteria #1–#7.
- `.planning/STATE.md` — current position, last-session decisions, Phase 1.1 hotfix log (still relevant for AWS Copilot deploy patterns).

### Phase 1 carry-forward (locked decisions; do NOT re-decide)

- `.planning/phases/01-foundation-identity/01-CONTEXT.md` — D-04 (CPF collected at first connect), D-16 (ConsentScreen reuse), D-18 (piiScrubber rule pattern), D-19 (audit_log catalogue extension model).
- `src/lib/crypto.ts` — AES-256-GCM `encrypt(plaintext)` / `decrypt(ciphertext)` helpers (Phase 1 plan 01-01). Use **as-is** for `pluggy_item_id`.
- `src/lib/piiScrubber.ts` — pluggable Rule corpus (Phase 1 plan 01-03). Phase 2 must NOT add Pluggy item id or transaction descriptions to logs in any code path.
- `src/lib/cpf.ts` — CPF validation + hash + encrypt helpers (Phase 1 plan 01-02). Reuse for the inline CPF field.
- `src/lib/env.ts` — Zod env schema (Phase 1 plan 01-04). Phase 2 adds `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ENV` (`sandbox|production`), `PLUGGY_WEBHOOK_SECRET`, `PLUGGY_SANDBOX_CLIENT_ID/SECRET` (test-only). OPS-04 sandbox/prod assertion already enforced; extend to Pluggy.
- `src/lib/mailer.ts` — SES sa-east-1 send wrapper with suppression guard + ConfigurationSet (Phase 1 plans 01-04 + 01-05). Reuse for `re-auth-notifier`.
- `src/lib/session.ts` — session-cookie reader (Phase 1 plan 01-02). Reuse for IDOR enforcement on every Phase 2 endpoint.
- `src/components/consent/ConsentScreen.tsx` — reusable consent component, accepts `scope` discriminated union (Phase 1 plan 01-03). Add `PLUGGY_CONNECT_PENDING` and `PLUGGY_CONNECTOR:{id}` variants.
- `src/components/banners/*` — banner pattern (Phase 1). Phase 2 adds `<ReAuthBanner>` to the `<BannerStack>` with priority > email-verification banner.
- `src/db/schema/webhookEvents.ts` — `webhook_events` table already supports `source='PLUGGY'`. No schema change needed for the events table; Phase 2 just inserts new rows with that source.
- `src/db/schema/auditLog.ts` — `audit_log` table; Phase 2 emits new event_type strings (D-13).
- `src/jobs/boss.ts` — pg-boss singleton client (Phase 1 plan 01-03). Phase 2 adds `pluggy.sync`, `pluggy.transfer-detector`, `pluggy.fatura-detector`, `pluggy.re-auth-notifier`, `pluggy.reconcile.stale-items` queues.
- `src/jobs/worker.ts` — worker entrypoint registers all queues (Phase 1 plan 01-03). Phase 2 adds the 5 new workers; reuse the testcontainers + integration test scaffolding from Phase 1 (plan 01-02 / 01-05).

### Stack and architecture (project-level research)

- `.planning/research/STACK.md` § BR-residency table, § Pluggy + react-pluggy-connect (locked Open Finance stack); § disqualified services (Vercel Postgres, Supabase, Neon — Phase 2 must not introduce any of these).
- `.planning/research/ARCHITECTURE.md` § System Overview, § Pattern 5 (Separate Worker Service), § Data Flow: Open Finance Ingestion (sequence diagram for connect → webhook → sync), § Schema Sketch (`pluggy_items`, `accounts`, `transactions`).
- `.planning/research/PITFALLS.md` — targeted sections (MUST read):
  - **P1** (TX-01 dedup with `UNIQUE(pluggy_transaction_id)` + `ON CONFLICT DO UPDATE`)
  - **P2** (item state model: LOGIN_ERROR / WAITING_USER_INPUT / OUTDATED — never sync broken items)
  - **P3** (webhook auth header + idempotency on `event_id`)
  - **P4** (encrypt `pluggy_item_id`, never log)
  - **P5** (sync is async; HTTP handler returns 202 in <200ms, all work in worker)
  - **P6** (do NOT trust Pluggy `category` field directly; Phase 3 territory but Phase 2 stores it as `transactions.pluggy_category` for Phase 3 weak-signal use)
  - **P7** (transfer detection: same |amount|, opposite type, same user, ≤3 days)
  - **P8** (credit-card fatura detection: checking debit matching card balance near due date)
  - **P9** (per-user sync rate limit: paid 30 min, free scheduled-only)
  - **P10** (sandbox/prod confusion — extend `lib/env.ts` to assert `PLUGGY_ENV='production'` when `NODE_ENV='production'`)
  - **P11** (per-data-source consent — `user_consents` append-only with scope `PLUGGY_CONNECTOR:{id}`)
  - **P13** (PII in logs — extend `piiScrubber` to scrub Pluggy item_id and transaction descriptions if any path tries to log them)
  - **P26** (IDOR on tx/account endpoints — every query joins `accounts.user_id = $session.user.id`)
  - **P28** (CPF validation + encryption at first connect — Phase 1 D-04 lands here)
  - **P35** (webhook replay after downtime — TX-06 reconciliation hourly cron, D-38)
  - **P36** (observability from day 1 — Phase 1 ships logs/Sentry; Phase 2 emits per D-47)
- `.planning/research/SUMMARY.md` § Phase 2 — confirms scope: pg-boss + Pluggy connect-token + react-pluggy-connect + webhook + sync workers + transfer/fatura + re-auth notifier + per-user cooldown + AES item-id + raw tx list.
- `.planning/research/FEATURES.md` — high-frequency BR merchants (informs sandbox fixture design + Phase 3 prep, but not Phase 2 logic).

### Pluggy official docs (MUST be read by researcher and planner)

- https://docs.pluggy.ai/llms.txt — entry index, full URL list of Pluggy doc tree.
- https://docs.pluggy.ai/docs/item-lifecycle — item status enum (UPDATING / LOGIN_ERROR / OUTDATED / WAITING_USER_INPUT / UPDATED), executionStatus values, state transitions, auto-sync once/day for healthy items.
- https://docs.pluggy.ai/docs/webhooks — full event list (item/created, item/updated, item/error, item/waiting_user_input, item/login_succeeded, item/deleted, connector/status_updated, transactions/created, transactions/updated, transactions/deleted; payment events out of Phase 2 scope), IP allowlist `177.71.238.212`, must respond 2xx in <5s, retry policy 3+3+3 over 2h, `item/login_succeeded` only 3 attempts no backoff.
- https://docs.pluggy.ai/docs/rate-limits — GET /transactions = 360 req/min/IP; **PATCH /items = 20 req/min/IP** (manual-sync hot path); 429 returns `RateLimit-Reset` and `Retry-After` headers.
- https://docs.pluggy.ai/docs/sandbox — test connectors (Pluggy Bank / Investments / PIX), creds (`password-ok`, `123456`), state-trigger username variations (`user-ok`, `user-locked`, `user-unavailable`, `user-error`, `user-ok-perf-XXx`), 30-day sandbox-item expiry, OF flow CPFs (`761.092.776-73` basic, `238.242.640-30` multi-auth approved).
- https://docs.pluggy.ai/reference/connect-token-create — POST /connect_token; same endpoint for new connections AND update mode (passes `itemId`); options field for product selection.
- https://docs.pluggy.ai/reference/items-delete — DELETE /items/:id, used by disconnect flow (CONN-05) and Phase 6 deletion workflow.
- https://docs.pluggy.ai/reference/transactions-list-by-cursor — cursor pagination for transaction sync; used by `pluggy-sync` worker.
- https://docs.pluggy.ai/reference/items-send-mfa — used only if we ever leave the widget for MFA (we don't, per D-11).

### Library docs (Pluggy SDKs)

- `pluggy-sdk@0.85` (npm, official Node SDK) — typed clients, retry handling. Wrapped by `src/services/PluggyService.ts`.
- `react-pluggy-connect@2.12` (npm, official widget wrapper) — `<PluggyConnect />` component, `onSuccess`, `onError`, `onClose`, `onMfa`, `connectToken`, `updateItem`, `selectedConnectorId` props.

### Global conventions

- `C:\Users\aless\.claude\CLAUDE.md` — naming (PascalCase classes, camelCase functions, snake_case columns/folders), acronym uppercase rules, commit template (`<type>(<scope>): <subject>`).
- `.\CLAUDE.md` (project) — repo-specific overrides; § Critical Pitfalls summary mirrors this CONTEXT's PITFALLS.md targeted reads.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1, ready to consume)

| Asset | Location | How Phase 2 uses it |
|-------|----------|---------------------|
| `crypto.ts` AES-256-GCM helpers | `src/lib/crypto.ts` | Encrypt `pluggy_item_id` on write to `pluggy_items.pluggy_item_id_enc`; decrypt only inside `PluggyService` |
| `piiScrubber` | `src/lib/piiScrubber.ts` | Already covers CPF, email, account-number patterns; Phase 2 must not add Pluggy item ID or transaction descriptions to log paths (no scrubber change required) |
| `cpf.ts` validator + hasher + encryptor | `src/lib/cpf.ts` | Inline consent-screen CPF field reuses validator; first-connect handler uses hash + encrypt |
| `env.ts` Zod schema | `src/lib/env.ts` | Add `PLUGGY_*` vars + extend OPS-04 sandbox/prod assertion to `PLUGGY_ENV` |
| `mailer.ts` SES wrapper + suppression guard | `src/lib/mailer.ts` | `re-auth-notifier` worker calls `sendMail()`; existing ConfigurationSet attached |
| `session.ts` cookie reader | `src/lib/session.ts` | Every `/api/pluggy/*` route uses `getSession()` for IDOR enforcement |
| `ConsentScreen` component | `src/components/consent/ConsentScreen.tsx` | Add `PLUGGY_CONNECT_PENDING` + `PLUGGY_CONNECTOR:{id}` to scope discriminated-union |
| `BannerStack` + nag-banner pattern | `src/components/banners/*` | Add `<ReAuthBanner>` with priority > email-verification |
| `webhook_events` table | `src/db/schema/webhookEvents.ts` | Already supports `source='PLUGGY'`; no schema change |
| `audit_log` table | `src/db/schema/auditLog.ts` | Phase 2 emits new event_type strings (D-13); no schema change |
| pg-boss client + worker entrypoint | `src/jobs/boss.ts`, `src/jobs/worker.ts` | Add 5 new queues + 5 new worker files |
| testcontainers + integration test runner | `scripts/run-e2e.ts` (Phase 1 plan 01-02) | Reuse for Phase 2 webhook/sync integration tests |
| Sentry EU + `beforeSend` PII scrubber | `src/lib/sentry.ts` | Phase 2 wraps `pluggy-sync` worker in `Sentry.startTransaction` (D-47) |
| pino logger | `src/lib/logger.ts`, `logger.edge.ts` | Worker emits structured logs per D-47 catalogue |

### Established Patterns (Phase 1 set; Phase 2 follows)

- **Webhook handler shape:** validate auth header → idempotent `webhook_events` insert → `boss.send()` → return 200 in <200ms. Phase 1 SES bounce handler is the reference (`src/app/api/webhooks/ses-bounce/route.ts`); Phase 2's Pluggy handler clones it with the Pluggy-specific signature header and event-type → queue mapping.
- **Worker shape:** one file per queue under `src/jobs/workers/*.ts`; consume `boss.work(queue, handler)` registered in `worker.ts`; idempotent (every handler must tolerate replay).
- **Service layer:** pure-TypeScript domain services under `src/services/*/`; testable in isolation; no HTTP calls in render paths. `PluggyService` follows the same pattern.
- **Schema barrel:** add new schema files under `src/db/schema/` and append exports to `src/db/schema/index.ts` in declaration order (Drizzle migration generation is order-sensitive).
- **Frontend forms:** React Hook Form + Zod; reuse `cpf` Zod refinement for the consent screen.
- **Email templates:** React Email components in `src/emails/*.tsx`; rendered to HTML at send-time by `mailer.ts`. Phase 2 adds `ReAuthRequired.tsx`.
- **Test runner orchestration:** Phase 1 plan 01-02 ships `scripts/run-e2e.ts` that boots testcontainers + rewrites `.env.local` BEFORE Playwright's webServer spawns. Phase 2 integration tests for webhooks reuse this scaffolding.

### Integration Points (consumed downstream)

- **`pluggy_items`, `accounts`, `transactions`** → consumed by Phase 3 (categorization), Phase 4 (dashboard pre-aggregation), Phase 5 (BILL-04 free-tier enforcement reads `accounts.status`), Phase 6 (deletion workflow + DSR export).
- **Encrypted `pluggy_item_id`** → consumed by Phase 6 deletion (Pluggy DELETE /items/:id call).
- **`audit_log` Phase 2 events** → consumed by Phase 6 admin views + LGPD-04 deletion-audit proof.
- **`webhook_events` Pluggy rows** → consumed by Phase 6 webhook-replay reconciliation (P35).
- **`<ReAuthBanner>`** → reused by Phase 5 (billing past_due → analogous banner) and Phase 6 (admin re-auth banner).
- **`PluggyService`** → consumed by Phase 6 deletion workflow (item-delete call).

</code_context>

<specifics>
## Specific Ideas

- **Reconnect deep-link UX walkthrough** (D-12 in motion): user clicks "Reconectar Itau" in re-auth email → `/connect?reconnect=abc-uuid` → app sees ?reconnect param → if not authenticated, `/login?next=...` → after login, server reads `pluggy_items` row → calls `PluggyService.createConnectToken({ userId, reconnectItemId: row.pluggy_item_id_decrypted })` → renders `<PluggyConnect connectToken={token} updateItem={true} onSuccess={...} />` widget. The Pluggy item id NEVER appears in the URL or in client-side state — only in the server-issued token.
- **CPF inline consent submit flow** (D-02 + D-06): single POST to `/api/connect/init` with body `{ cpf, consent: { scope: 'PLUGGY_CONNECT_PENDING', granted: true } }`. Server: (1) validate CPF check-digit, (2) check `users.cpf_hash` — if already populated, skip CPF write; if null, encrypt + hash + UPDATE; (3) INSERT `user_consents` (PLUGGY_CONNECT_PENDING); (4) call Pluggy `POST /connect_token`; (5) return `{ connectToken, expiresAt }`. Client receives token, opens widget. On widget `onSuccess(itemId)`: client POSTs `/api/pluggy/items` with `{ itemId, connectorId }` → server creates `pluggy_items` + appends `user_consents(scope='PLUGGY_CONNECTOR:{id}')` + enqueues `pluggy-sync` (D-07).
- **Sandbox vs production CPF semantics:** sandbox accepts `761.092.776-73` for OF basic flow. Our CPF validator must NOT special-case it; sandbox-mode handling lives in `PluggyService` (uses `PLUGGY_SANDBOX_*` env). The CPF the user enters on our consent screen is theirs, not Pluggy's test value. (Pluggy's OF flow may itself prompt for the OF-test CPF inside the widget — that's between user and Pluggy.)
- **Plain-pt-BR error messages user-facing** for the 4 most common failure modes:
  - CPF invalid: *"CPF inválido. Verifique os dígitos e tente novamente."*
  - Pluggy widget closed before success: *"Conexão cancelada. Tente novamente quando estiver pronto."*
  - Cooldown active: *"Aguarde {N} minutos para sincronizar novamente."*
  - Pluggy 429 (rate limit, our fault): *"Estamos com tráfego alto. Tente em alguns minutos."*
  - Pluggy item LOGIN_ERROR mid-sync: *"Sua conexão com {Banco} expirou. Reconecte para continuar."* + Reconnect button.
- **Free-tier paywall stub copy** (D-29 + D-49): modal title *"Plano gratuito limitado"*, body *"Conexões adicionais e sincronização manual estão disponíveis no plano pago. Cancele quando quiser."*, CTA *"Ver planos"* → `/settings/billing` (Phase 5 wires the actual page).
- **Reconnect email subject precedent:** `Reconecte seu Itau` (no subject prefix like `[Portal Finance]` — Phase 1 D-15 pattern). Plain spoken pt-BR.
- **Sandbox fixture user identity:** `test+pluggy@portalfinance.app` with a deterministically-seeded password, used only by the integration test suite. CPF on this fixture user = a sandbox-safe valid CPF (NOT a real CPF that could ever resolve to a real Brazilian).

</specifics>

<deferred>
## Deferred Ideas

### Reviewed but not folded (carry-forward to future phases)

- **Transfer/fatura override UI** — Phase 3 (CAT-03 correction interaction). False-positive un-flag handled there.
- **Per-account balance hide/show toggle** — Phase 4 polish.
- **Skeleton loaders on /transactions during sync** — Phase 4 dashboard polish.
- **OpenTelemetry custom counters/histograms** — Phase 6 (OPS-02 alert thresholds).
- **`/accounts` separate page** (vs `/settings/connections`) — Phase 4 if a richer "balances + last sync" utility view becomes valuable.
- **Combined "Pendências" banner** (single banner with multi-action modal) — Phase 6 polish.
- **executionStatus phase breakdown on syncing UI** — Phase 6 if users complain about long syncs.
- **Sentry per-user transaction tags + cost dashboards** — Phase 6 (OPS-02).
- **Free-tier scheduled cron beyond Pluggy auto-sync** — Phase 6 if Pluggy's auto-sync drops items.
- **Categories table + FK migration** — Phase 3 (CAT-01..06).
- **Real paywall modal (not stub)** — Phase 5 (BILL-04 + BILL-01).
- **Full deletion workflow** (Pluggy DELETE + log anonymization + email-list removal + 30-day legal hold + DSR export) — Phase 6 (LGPD-03, LGPD-04). Phase 2 only ships disconnect (stop sync, keep history).
- **Full DASH-05 filter set** (free-text search) on `/transactions` — Phase 4 (DASH-05).
- **Webhook-event-driven cache invalidation for `subscription_tier`** — Phase 5 (BILL-02).
- **Encrypted `webhook_events.payload`** — Phase 6 hardening if PII review identifies risk.
- **Admin views over Pluggy data with re-auth + audit_log** — Phase 6 (SEC-03).
- **Feature flag: enable/disable specific Pluggy connectors** — not in roadmap; tracked here for ops use later.
- **Multi-region read replicas for `transactions`** — out of scope; v1 single-region sa-east-1.

</deferred>

---

*Phase: 02-pluggy-ingestion*
*Context gathered: 2026-05-01*
