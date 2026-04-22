# Feature Research

**Domain:** Brazilian personal finance management (PWA, middle class R$3k–R$15k/month)
**Researched:** 2026-04-22
**Confidence:** MEDIUM — based on training data through Aug 2025; WebSearch/WebFetch tools denied; all product knowledge reflects public feature sets of competitors as of last training. Flag for validation before roadmap lock.

---

## Competitor Reference Set

| Product | Country | Status | Positioning |
|---------|---------|--------|-------------|
| Mobills | BR | Active | Mass market, manual + auto sync, freemium |
| Organizze | BR | Active | Manual-first, small business lean, freemium |
| Olivia | BR | Active (pivot to AI) | Conversational AI, WhatsApp integration |
| Guiabolso | BR | Closed (acquired by PicPay ~2021) | First mover on Open Finance aggregation |
| Poup | BR | Active | Habit-formation, gamification, savings |
| Meu Dinheiro | BR | Active (niche) | Manual entry, simplicity |
| Visor Finance | BR | Active (reference product) | Clean UI, tiered subscription, Open Finance |
| Minhas Economias | BR | Active | Investment focus, patrimônio view |
| Monarch Money | US | Active (reference) | Premium subscription-only, household budgeting |
| Flourish Fi | US | Active | Savings gamification, employer-sponsored |

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features where absence causes immediate churn or store-review complaints.

#### Account Connection and Sync

| Feature | Why Expected | Complexity | v1 Bucket | Depends On | Notes |
|---------|--------------|------------|-----------|------------|-------|
| Connect bank accounts via Open Finance (Pluggy) | Guiabolso created this expectation; BR users expect at least major banks (Itaú, Bradesco, Caixa, Santander, BB, Nubank, Inter) | HIGH | v1 MVP | Auth, Pluggy integration | Support for Pluggy item creation + webhook |
| Connect credit cards (separate from bank account) | Most BR users carry cartão de crédito independently from their conta corrente; they expect both | HIGH | v1 MVP | Account connection | Cartão fatura must be handled separately from the underlying bank account |
| Display sync status clearly (last synced timestamp, syncing indicator) | Users trained by Guiabolso/Mobills to see "última atualização"; anxiety-generating when absent | LOW | v1 MVP | Account connection | Show per-account, not just global |
| Manual re-sync on demand | Users want control especially when sync fails; trust collapses if they cannot force a refresh | LOW | v1 MVP | Account connection | Rate-limit to avoid Pluggy cost explosion |
| Re-sync failure surface and recovery flow | Connection tokens expire; Open Finance consents expire (max 12 months by BR regulation); users need a clear "reconnect" CTA | MEDIUM | v1 MVP | Account connection | Pluggy sends webhook on item status change; surface as in-app notification + email |
| Out-of-band (OOB) re-authentication recovery | Banks requiring multi-factor redirect (most major BR banks) will drop connections; recovery must be frictionless or users abandon | HIGH | v1 MVP | Account connection | Pluggy handles redirect; app must surface the reconnect step clearly |
| Disconnect / remove account | LGPD and user trust; users must be able to cleanly remove a connection | LOW | v1 MVP | Account connection | Delete Pluggy item + cascade delete transactions (or anonymize) |

#### Transaction Feed and Categorization

| Feature | Why Expected | Complexity | v1 Bucket | Depends On | Notes |
|---------|--------------|------------|-----------|------------|-------|
| Transaction list with amount, date, description, category | Core data surface; nothing works without it | LOW | v1 MVP | Account connection | Show merchant name when available, fall back to bank description |
| Filter by month | Universal expectation; monthly mental model is dominant in BR | LOW | v1 MVP | Transaction list | Month-picker with prev/next navigation |
| Filter by account | Multi-account users need per-account view | LOW | v1 MVP | Transaction list | — |
| Filter by category | Power-user expectation; all competitors have it | LOW | v1 MVP | Transaction list | — |
| Free-text search | "Where did I spend at that restaurant?" is a common need | LOW | v1 MVP | Transaction list | Search on description + merchant |
| Automatic categorization on import | Guiabolso/Mobills trained users to expect this; manual entry is a dealbreaker for sync users | HIGH | v1 MVP | Account connection | Rules-first + LLM fallback per PROJECT.md |
| Correct a category on a single transaction | Mistakes happen; users demand the ability to fix | LOW | v1 MVP | Categorization | Inline edit in list or in detail modal |
| System learns from corrections (merchant-level rule) | Mobills/Guiabolso both had this; users feel cheated when they have to re-correct the same merchant | MEDIUM | v1 MVP | Category correction | Store merchant → category mapping per user |
| Mark transaction as transfer between own accounts | Double-counting is the #1 categorization complaint; e.g., paying fatura de cartão from checking creates a ghost debit + credit | MEDIUM | v1 MVP | Transaction list | Must suppress transfers from income/expense totals |
| Income vs. expense differentiation | Fundamental; credit vs. debit designation must be visible | LOW | v1 MVP | Transaction list | Auto-derive from Pluggy amount sign |
| Pending vs. cleared transaction state | BR bank APIs often return pending transactions; showing them prevents "my money disappeared" anxiety | LOW | v1 MVP | Account connection | Grey-out pending or badge them |

#### Monthly Dashboard

| Feature | Why Expected | Complexity | v1 Bucket | Depends On | Notes |
|---------|--------------|------------|-----------|------------|-------|
| Total income for the month | Baseline KPI every user looks for | LOW | v1 MVP | Categorization | Sum of income transactions |
| Total expenses for the month | Baseline KPI | LOW | v1 MVP | Categorization | Sum of expense transactions |
| Net result (income minus expenses) | Core health indicator; red/green feedback | LOW | v1 MVP | Income + expense totals | Positive = saved, negative = overspent |
| Breakdown by category (chart + list) | "Where did my money go?" is the core product promise | MEDIUM | v1 MVP | Categorization | Donut or horizontal bar is dominant pattern in BR apps |
| Top spending categories | Quick-scan summary; all competitors surface this | LOW | v1 MVP | Categorization | Top 5 by amount |
| Month comparison (vs. prior month) | Users want context; "am I doing better?" question | MEDIUM | v1 MVP | 2+ months of data | Show % delta or absolute delta next to totals |
| Recurring bill detection | Assinaturas (Netflix, Spotify, gym, etc.) are a pain point; detecting them automatically is valued | HIGH | v1.x | Categorization + history | Requires 2–3 months of history to detect patterns |

#### Subscription / Billing / Paywall UX

| Feature | Why Expected | Complexity | v1 Bucket | Depends On | Notes |
|---------|--------------|------------|-----------|------------|-------|
| Free tier that genuinely works (1 account, limited history) | Free tier must not feel crippled to the point of uselessness or users leave before converting | LOW | v1 MVP | Auth, account connection | Enforce: 1 Pluggy item; 90-day history window; manual-only sync (no background auto-sync) |
| Clear upgrade CTA at free tier limits | Users need to know why something is blocked and how to unlock it | LOW | v1 MVP | Paywall enforcement | Show "upgrade to unlock" in context, not just in settings |
| Checkout / payment in BRL with boleto + cartão de crédito + PIX | Brazilian users expect all three; missing cartão or boleto causes abandonment | MEDIUM | v1 MVP | Billing provider | Stripe supports BRL; ASAAS/Iugu/Pagar.me are BR-native alternatives |
| Annual plan with visible discount (typically ~20–30% off) | BR SaaS norm; Monarch Money, Visor Finance, all use this | LOW | v1 MVP | Billing | Show monthly equivalent when annual is selected |
| Subscription management (change plan, cancel) inside app | LGPD + App Store equivalents: users must be able to cancel without emailing support | MEDIUM | v1 MVP | Billing provider | Cancel means cancel; do not hide it |
| Confirmation email + NF-e (nota fiscal) | BR businesses are legally required to issue NF-e for service subscriptions; missing it causes chargebacks and distrust | MEDIUM | v1 MVP | Billing provider | Choose billing provider that handles NF-e automatically (ASAAS/Iugu do; Stripe does not) |
| Trial period (7–14 days) | Standard expectation for paid-only features; lowers signup friction | LOW | v1 MVP | Billing | 7-day trial is common in BR market (Organizze, Visor); 14-day is safe |

#### Auth and Identity

| Feature | Why Expected | Complexity | v1 Bucket | Depends On | Notes |
|---------|--------------|------------|-----------|------------|-------|
| Email + password registration | Baseline | LOW | v1 MVP | — | — |
| CPF validation at registration | Pluggy requires CPF to create user-linked items; also de-duplication signal | LOW | v1 MVP | Auth | Format validation + Receita Federal check digit algorithm |
| Password reset via email | Universal expectation | LOW | v1 MVP | Auth, email | — |
| LGPD consent at registration | Non-negotiable legally | LOW | v1 MVP | Auth | Explicit per-category consent (data processing, Open Finance access) |
| Data deletion request (right to erasure) | LGPD Article 18; must be complete + auditable | MEDIUM | v1 MVP | Auth | Cascade delete: Pluggy items, transactions, user record |
| Session management (logout, see active sessions) | Financial data; users expect security controls | LOW | v1 MVP | Auth | At minimum: logout + session expiry |

---

### Differentiators (Competitive Advantage)

Features where superior execution creates a moat for the BR middle-class segment.

#### Categorization Quality (Core Differentiator — v1 MVP)

| Feature | Value Proposition | Complexity | v1 Bucket | Depends On | Notes |
|---------|-------------------|------------|-----------|------------|-------|
| PIX transaction classification | PIX transfers are ambiguous — could be income (received salary, payment from client), expense (paying rent, service), or internal transfer; auto-classifying by direction + description is uniquely Brazilian | HIGH | v1 MVP | Categorization engine | Pattern-match description ("PIX RECEBIDO", "PIX ENVIADO", chave PIX type); infer income vs expense vs transfer |
| Fatura de cartão de crédito handling | Paying the fatura from checking must NOT appear as an expense; it's a transfer; this is the most common double-counting bug in BR apps | HIGH | v1 MVP | Transfer detection | Match debit from checking to the credit card item owned by same user |
| Merchant name normalization | Bank descriptions are cryptic ("PGTO DEB AUT 12345 LOJA XYZ SP"); cleaning to human-readable names ("Loja XYZ") reduces correction fatigue | HIGH | v1 MVP | Categorization engine | Rules table of known BR merchant patterns + LLM normalization |
| Bulk re-categorization ("all transactions at merchant X → category Y") | Power users batch-fix; feels like control | MEDIUM | v1.x | Category correction | Requires merchant grouping in the data model |
| Split transaction (one entry → two categories) | Restaurant tip + meal is classic example; gym + supplement at same place | MEDIUM | v1.x | Transaction detail | Complex UI and data model; defer until basic correction works |
| Correct-and-learn with confidence indicator | Show the user when a category was auto-inferred vs. rule-confirmed; low-confidence items surfaced for review | HIGH | v1.x | Categorization engine | Requires scoring pipeline; high value but needs data to be trustworthy first |

#### Brazilian Income Patterns

| Feature | Value Proposition | Complexity | v1 Bucket | Depends On | Notes |
|---------|-------------------|------------|-----------|------------|-------|
| 13º salário detection and annotation | Brazilian law mandates a 13th salary in November/December; recognizing it avoids "why is my income so high this month?" confusion | MEDIUM | v1.x | Categorization, income detection | Detect by amount (≈ regular salary) + month (Nov/Dec); tag as "13º" |
| Vale alimentação / Vale refeição classification | VR/VA are separate income-like credits loaded on benefit cards; Pluggy may surface them; must not be double-counted | MEDIUM | v1.x | Categorization | Detect by card type (Alelo, Sodexo, VR, Ticket) |
| Salário detection (recurring monthly credit) | Automatically tagging the main recurring salary credit reduces noise and provides better net income calculation | MEDIUM | v1 MVP | Categorization engine | Pattern: recurring credit, similar amount ±5%, same account, ~same day of month |

#### Dashboard Insights

| Feature | Value Proposition | Complexity | v1 Bucket | Depends On | Notes |
|---------|-------------------|------------|-----------|------------|-------|
| Anomaly alert ("you spent 3× more on Restaurantes this month") | Proactive insight rather than passive chart; users feel smart | MEDIUM | v1.x | 2+ months of history | Compare to personal rolling average; not market average |
| Recurring bill total summary | "You spend R$389/month on subscriptions" is actionable; competitors mostly miss this clean summary | MEDIUM | v1.x | Recurring detection | Requires pattern detection feature |
| Emergency reserve indicator | BR financial education content heavily promotes reserva de emergência (3–6× monthly expenses); surfacing "your current reserve covers X months" is locally resonant | MEDIUM | V2 | Goals feature | Requires savings account tagging + expense history |
| Net worth evolution over time (patrimônio) | Power users want to see wealth growing; Minhas Economias differentiates here | HIGH | V2 | Investment integrations | Requires brokerage + real estate data; deferred per PROJECT.md |
| Category trend chart (6-month rolling) | "Am I improving?" is the retention hook | MEDIUM | v1.x | 3+ months of data | Line chart per category across last 6 months |

#### Subscription / Monetization Differentiators

| Feature | Value Proposition | Complexity | v1 Bucket | Depends On | Notes |
|---------|-------------------|------------|-----------|------------|-------|
| Downgrade flow that preserves data (doesn't delete history) | Trust signal; users fear losing their history when canceling | LOW | v1 MVP | Billing, data model | Cap active sync; keep historical data in read-only mode |
| Pause subscription (not available in most BR apps) | Reduces cancellation by offering an alternative for tight months | MEDIUM | v1.x | Billing provider | Pause = suspend billing for 1–3 months; re-activates automatically |
| Reactivation win-back email sequence | Standard SaaS but missing from most BR fintech apps | LOW | v1.x | Email/CRM | Triggered 7 days after cancel; show "your data is still here" |
| Annual plan with installments ("parcele em 12×") | BR norm for annual subscriptions; selling annual upfront in one lump sum has lower conversion; offering 12× parcelamento via cartão increases uptake | MEDIUM | v1.x | Billing provider | Iugu/ASAAS support parcelamento natively; Stripe requires workaround |

#### PWA / Mobile UX

| Feature | Value Proposition | Complexity | v1 Bucket | Depends On | Notes |
|---------|-------------------|------------|-----------|------------|-------|
| Add-to-home-screen prompt (A2HS) | PWA install converts casual visitors to daily users | LOW | v1 MVP | PWA manifest | Trigger after second visit or after first sync |
| Offline transaction list (read-only from cache) | Users check balances while on low connectivity; all-white screen = app feels broken | MEDIUM | v1.x | Service worker | Service worker + stale-while-revalidate for last synced data |
| Push notifications for sync failures | Users don't open the app daily; notify them when a connection breaks before they notice data is stale | MEDIUM | v1.x | PWA push, account connection | Requires VAPID keys + notification consent flow |

---

### Anti-Features (Deliberately NOT Build)

Features that seem appealing but create disproportionate cost or harm in this context.

| Feature | Why Requested | Why Anti-Feature | What to Do Instead | v1 Bucket |
|---------|---------------|------------------|--------------------|-----------|
| Manual transaction entry (full CRUD) | Power users from Organizze/Mobills habit | Contradicts the core value ("see without work"); attracts a different persona who won't pay for sync; doubles the data model complexity (manual vs synced transactions must co-exist cleanly) | Allow correction and recategorization of synced transactions only; evaluate manual entry as a v1.x addition only if requested by paying subscribers | Never (reassess at v1.5) |
| Budget creation and tracking (envelopes) | YNAB fans and Organizze users expect it | Budgets require correct categorization to be trusted; shipping budgets before categorization quality is validated creates distrust at launch; also dramatically increases UX complexity | Defer until categorization accuracy is validated with real users; then ship as a v1.x differentiator | v1.x (not v1 MVP) |
| Shared / family accounts | "My partner needs access too" | Requires a complete permissions model (who can see what?), multi-user billing edge cases, and privacy complications; high complexity for a single-persona MVP | Single-user v1; revisit once product-market fit is established | V2 |
| Real-time transaction feed (webhook-push to client) | "Why isn't this instant?" | Pluggy webhooks fire when banks push data — which for most BR banks is batch (end of day or triggered by user in bank app); real-time is technically infeasible for most connections and creates false expectations | Set accurate expectations in onboarding ("transactions update when your bank reports them, usually once a day") | Never (misleading) |
| In-app advertising for free tier | Monetization before subscribers | Ads in a financial app signal untrustworthiness to the exact audience you need to convert; harms brand with middle class target | Activate only after meaningful free-tier audience AND paid subscriber base is established per PROJECT.md | v1.x at earliest |
| Social / community features ("compare with friends") | Gamification appeal | Financial data sharing is deeply private in BR culture; creates LGPD liability; community features require moderation at scale | Focus on personal insights; never push social comparison | Never |
| Native iOS / Android apps | "The app feels slow" | PWA is sufficient for v1 validation; native doubles the build + maintenance cost for a pre-seed team | Ship PWA first; build native only when subscriber count justifies it and PWA performance is actually the bottleneck | V2 |
| CSV / OFX export | Power users want their data | Not wrong to build, but zero retention value; attracts data hoarders who won't subscribe | Offer as a premium feature in v1.x to reduce churn among power users who distrust lock-in | v1.x |
| Goal tracking / objetivos | Goal-setting is emotionally motivating | Goals are only meaningful when categorization is correct; users who set goals on wrong data lose trust in the whole app; also a separate design challenge | Defer until 3+ months of validated categorization data per PROJECT.md | V2 |
| Investment / brokerage tracking | Middle class users hold Tesouro Direto, CDB, Fundos | Requires brokerage integrations not in Pluggy base plan; patrimônio view is a separate product surface; risks under-delivering and creating distrust | Defer as V2 per PROJECT.md; do not surface partial data | V2 |

---

## Brazilian-Specific Feature Callouts

These features have no meaningful international equivalent and must be treated as first-class concerns, not edge cases.

### PIX Classification (HIGH priority — v1 MVP)

PIX is the dominant Brazilian payment rail (over 4 billion transactions/month as of 2025). A personal finance app that cannot correctly classify PIX transactions is broken for Brazilian users.

Key classification logic required:
- `PIX RECEBIDO` / `TED RECEBIDA` → likely income or internal transfer; prompt user or infer from chave PIX (CPF = self → transfer)
- `PIX ENVIADO` → expense or transfer; check if destination chave is a known own-account CPF/chave
- PIX for condominium, rent, service providers → common expense categories; merchant name matching critical
- PIX amount matching for known recurring payments (rent, internet, etc.) → auto-categorize

### Fatura de Cartão (HIGH priority — v1 MVP)

The most common double-counting bug across all BR apps. When a user pays their credit card bill (fatura) from their checking account:
- A `debit` appears on the checking account
- `Credit` transactions appear on the credit card account
- Both must NOT be counted as expenses

Detection logic:
- Match the fatura debit on checking against the sum of credit card charges for the same period ± tolerance
- Mark the fatura debit as a transfer, not an expense
- Surface any discrepancy between the fatura amount and the sum of charges (installment differences, IOF, etc.) as a notification

### 13º Salário (MEDIUM priority — v1.x)

- Occurs in two installments: first half in November, second in December (by BR law)
- Amounts to one additional monthly salary
- Without annotation, November/December will look like abnormally high-income months distorting annual averages
- Detection: recurring salary amount appears twice in the same month OR a credit of ≈ salary amount arrives in Nov/Dec from the same employer CNPJ

### Reserva de Emergência (MEDIUM priority — V2)

- The dominant personal finance advice in BR (Nubank blog, Nubanner, YouTube content) centers on building a 6-month emergency reserve
- Middle-class users have internalized this framing
- An indicator showing "your reserve = X months of your average spending" is locally resonant and drives savings account connection
- Requires: categorized expense history + savings account tagging + goal engine (all deferred to V2)

### Vale Refeição / Vale Alimentação (LOW priority — v1.x)

- VR/VA benefit cards (Alelo, Sodexo, VR Benefícios, Ticket, Flash, Caju) are ubiquitous for formal sector employees
- Pluggy may surface these as connected accounts
- Must not be double-counted against salary
- Categorize VR spend as "Alimentação" automatically; VA as "Mercado"
- Balance available on benefit card is a useful dashboard metric

### Parcelamento (Installments) on Credit Card (MEDIUM priority — v1.x)

- BR consumers routinely purchase in 2×, 3×, 6×, 12× installments on credit card
- Each installment appears as a separate monthly charge with descriptions like "01/06 MAGAZIN LUIZA" or "2/12 AMERICANAS"
- Smart grouping: surface the parent purchase + remaining installments
- Without this, the transaction list is full of fragments that users cannot map to a purchase decision
- Detection: regex on description (digits/digits pattern), group by merchant + total installments

### INSS / IR Deductions on Payslip (LOW priority — v1.x)

- Many users have salary credits net of INSS and IR deductions
- The gross salary is not the number that lands in the account
- Some open finance connections (mainly INSS e-Social) may surface the gross salary; the app must reconcile this with the net credit

---

## Feature Dependencies

```
[Auth / Registration]
    └──requires──> [Transaction List]
                       └──requires──> [Account Connection (Pluggy)]
                                           └──requires──> [Sync Status Display]
                                           └──requires──> [Re-sync / OOB Recovery]

[Automatic Categorization]
    └──requires──> [Account Connection]
    └──enables──>  [Monthly Dashboard]
    └──enables──>  [Category Correction]
                       └──enables──> [Merchant Learning]
                       └──enables──> [Bulk Re-categorization] (v1.x)

[Transfer Detection (Fatura + PIX)]
    └──requires──> [Account Connection (both checking + credit card)]
    └──enables──>  [Correct income/expense totals on Dashboard]

[Monthly Dashboard]
    └──requires──> [Categorization]
    └──requires──> [Transfer Detection]
    └──enables──>  [Month Comparison] (needs 2+ months)
    └──enables──>  [Anomaly Detection] (needs 3+ months) (v1.x)

[Recurring Bill Detection]
    └──requires──> [3+ months transaction history]
    └──enables──>  [Recurring Bill Summary on Dashboard] (v1.x)

[Subscription / Billing]
    └──requires──> [Auth]
    └──enables──>  [Paywall Enforcement]
    └──enables──>  [Free tier limits]

[Budget Tracking]
    └──requires──> [Categorization — validated and trusted]
    └──requires──> [3+ months data for baseline]
    (deferred to v1.x)

[Parcelamento Grouping]
    └──requires──> [Transaction List]
    └──requires──> [Credit Card Account Connection]
    (deferred to v1.x)

[Anomaly Detection]
    └──requires──> [Categorization]
    └──requires──> [3+ months history]
    (deferred to v1.x)

[13º Salary Detection]
    └──requires──> [Salary Detection (recurring income pattern)]
    (deferred to v1.x)

[PWA Push Notifications]
    └──requires──> [Service Worker]
    └──requires──> [Sync failure webhook from Pluggy]
    (deferred to v1.x)

[Pause Subscription]
    └──requires──> [Billing provider that supports pause]
    (deferred to v1.x)

[Emergency Reserve Indicator]
    └──requires──> [Goals engine]
    └──requires──> [Savings account tagging]
    └──requires──> [3+ months expense history]
    (deferred to V2)
```

### Dependency Notes

- **Transfer detection requires both accounts connected:** If a user only has checking connected (not the credit card), fatura matching cannot occur. Show a "connect your credit card to avoid double-counting" prompt.
- **Anomaly detection requires history:** Cannot launch with this in v1 MVP because new users have zero history. Design the data pipeline to accumulate it from day one so v1.x can surface it.
- **Budgets require categorization trust:** If the user has corrected >20% of their categorized transactions, budgets will feel wrong. Validate categorization accuracy before budgets.
- **Parcelamento grouping conflicts with simple transaction list:** Grouping installments requires a separate UX pattern (expand/collapse parent). Do not combine with the initial simple list.

---

## MVP Definition

### Launch With — v1 MVP

Minimum viable product. Every item below is required on day one for the product to not feel broken.

- [x] **Auth (email + CPF + password, LGPD consent, password reset)** — identity foundation; CPF required for Pluggy
- [x] **Account connection via Pluggy (bank + credit card)** — core value delivery mechanism
- [x] **Sync status display (per-account last synced, syncing indicator)** — trust signal
- [x] **Manual re-sync on demand** — user control
- [x] **OOB / re-authentication recovery flow** — Open Finance consents expire; no recovery = silent data staleness
- [x] **Transaction list (amount, date, description, category, income/expense tag)** — primary data surface
- [x] **Filter by month / account / category + free-text search** — basic usability
- [x] **Pending vs. cleared transaction state** — prevents anxiety
- [x] **Automatic categorization (rules-first + LLM fallback)** — core differentiator
- [x] **PIX transaction classification** — Brazilian table stakes
- [x] **Fatura de cartão transfer detection** — prevents double-counting, critical trust issue
- [x] **Category correction (inline) + merchant-level learning** — product promise of "learns from you"
- [x] **Monthly dashboard (income, expenses, net result, breakdown by category, top 5 categories, month vs prior month)** — core value delivery
- [x] **Salary detection (recurring income auto-tag)** — cleans up income view
- [x] **Free tier enforcement (1 account, 90-day history, manual sync only)** — monetization gate
- [x] **Subscription checkout (BRL, cartão + PIX + boleto, annual + monthly, 7–14 day trial)** — revenue
- [x] **NF-e issuance on subscription** — Brazilian legal requirement
- [x] **Subscription management (change plan, cancel) inside app** — LGPD + user trust
- [x] **Downgrade preserves historical data (read-only)** — churn reducer
- [x] **Clear upgrade CTA at free-tier limits** — conversion driver
- [x] **PWA manifest + add-to-home-screen prompt** — mobile usability
- [x] **LGPD data deletion request flow** — legal requirement
- [x] **Disconnect account (cascade delete or anonymize)** — legal + user trust

### Add After Validation — v1.x

Add these once the v1 MVP has real users and the core categorization pipeline is trustworthy.

- [ ] **Recurring bill detection + summary** — trigger: 3+ months of user data in system
- [ ] **Anomaly detection ("you spent 3× more on X")** — trigger: 3+ months of history + categorization accuracy validated
- [ ] **Category trend chart (6-month rolling)** — trigger: enough history
- [ ] **13º salário detection and annotation** — trigger: November cycle approaches
- [ ] **Vale Refeição / Vale Alimentação classification** — trigger: user reports of mis-categorization
- [ ] **Parcelamento grouping (installments)** — trigger: user complaints about fragmented credit card view
- [ ] **Bulk re-categorization ("all X at merchant Y")** — trigger: power users requesting it
- [ ] **Budget creation and tracking** — trigger: categorization accuracy validated + user requests
- [ ] **Offline read-only mode (service worker cache)** — trigger: PWA performance complaints
- [ ] **Push notifications for sync failures** — trigger: users missing stale data silently
- [ ] **Pause subscription flow** — trigger: cancellation interview feedback
- [ ] **Reactivation win-back email sequence** — trigger: first batch of cancellations
- [ ] **Annual plan with parcelamento (12× installments)** — trigger: billing provider setup
- [ ] **In-app ads for free tier** — trigger: significant free-user audience (10k+ MAU free)
- [ ] **CSV / OFX data export (premium)** — trigger: power-user churn signal
- [ ] **Correct-and-learn confidence indicator** — trigger: categorization pipeline mature

### Future Consideration — V2+

Defer until product-market fit is established and the subscriber base justifies investment.

- [ ] **AI assistant / chat over data** — expensive per PROJECT.md; data layer must be solid first
- [ ] **Goals / objetivos** — requires trusted categorization and willing-to-engage persona
- [ ] **Patrimônio view (investments, real estate, liabilities)** — requires brokerage integrations beyond Pluggy base
- [ ] **Marketplace (investments, credit, insurance, pension)** — regulatory posture + validated subscriber base
- [ ] **Emergency reserve indicator** — requires goals engine + savings tagging
- [ ] **Shared / family accounts** — permissions model complexity
- [ ] **Native iOS / Android apps** — PWA must first prove insufficient
- [ ] **Multi-currency / multi-country** — Brazil-only v1 is explicit constraint

### Never Build

- [ ] **Social / community comparison features** — privacy culture mismatch, LGPD liability
- [ ] **Real-time transaction feed (misleading for BR bank infrastructure)** — set accurate expectations instead
- [ ] **Manual transaction entry as a core feature** — contradicts "see without work" core value (reevaluate only if paying subscribers request it and sync persona validated)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Account connection + sync (Pluggy) | HIGH | HIGH | P1 |
| Sync status + re-sync + OOB recovery | HIGH | MEDIUM | P1 |
| Transaction list + filters | HIGH | LOW | P1 |
| Automatic categorization | HIGH | HIGH | P1 |
| PIX classification | HIGH | MEDIUM | P1 |
| Fatura transfer detection | HIGH | MEDIUM | P1 |
| Category correction + merchant learning | HIGH | MEDIUM | P1 |
| Monthly dashboard | HIGH | MEDIUM | P1 |
| Salary detection | MEDIUM | MEDIUM | P1 |
| Subscription checkout (BRL, all methods) | HIGH | HIGH | P1 |
| NF-e on subscription | MEDIUM | LOW | P1 (legal) |
| Free tier enforcement + paywall CTA | HIGH | LOW | P1 |
| LGPD consent + deletion | HIGH | MEDIUM | P1 (legal) |
| Month comparison on dashboard | MEDIUM | LOW | P1 |
| Downgrade data preservation | MEDIUM | LOW | P1 |
| PWA / A2HS | LOW | LOW | P1 |
| Recurring bill detection | MEDIUM | HIGH | P2 |
| Anomaly detection | MEDIUM | HIGH | P2 |
| 13º salário detection | MEDIUM | MEDIUM | P2 |
| Parcelamento grouping | MEDIUM | HIGH | P2 |
| Budget tracking | HIGH | HIGH | P2 |
| Bulk re-categorization | MEDIUM | MEDIUM | P2 |
| Pause subscription | LOW | MEDIUM | P2 |
| Push notifications | MEDIUM | MEDIUM | P2 |
| Offline mode | LOW | HIGH | P3 |
| CSV/OFX export | LOW | LOW | P3 |
| Goals / patrimônio | HIGH | VERY HIGH | P3 (V2) |
| AI assistant | HIGH | VERY HIGH | P3 (V2) |
| Marketplace | HIGH | VERY HIGH | P3 (V2) |

**Priority key:**
- P1: Must have for launch (v1 MVP)
- P2: Should have, add after v1 validation (v1.x)
- P3: Nice to have or future consideration (V2+)

---

## Competitor Feature Analysis

| Feature | Mobills | Organizze | Olivia | Visor Finance | Portal Finance v1 |
|---------|---------|-----------|--------|---------------|-------------------|
| Bank sync (Open Finance/scraping) | Yes (paid) | Yes (paid) | Yes | Yes | Yes — Pluggy |
| Manual entry | Yes | Yes (primary) | Limited | Limited | No (anti-feature) |
| Automatic categorization | Yes | Limited | Yes (AI) | Yes | Yes — rules + LLM |
| Category correction | Yes | Yes | Yes | Yes | Yes |
| Merchant learning | Basic | No | Yes | Unknown | Yes |
| PIX classification | Partial | No | Partial | Unknown | Yes — first class |
| Fatura transfer detection | Partial | Manual | Unknown | Unknown | Yes — automatic |
| 13º detection | No | No | No | Unknown | v1.x |
| Parcelamento grouping | Partial | No | No | Unknown | v1.x |
| Budget tracking | Yes | Yes | No | Limited | v1.x |
| Monthly dashboard | Yes | Yes | Yes | Yes | Yes |
| Anomaly alerts | No | No | Yes | No | v1.x |
| Recurring bill detection | Basic | No | Partial | No | v1.x |
| Goals | Yes | No | No | No | V2 |
| Investment / patrimônio | No | No | No | No | V2 |
| AI assistant | No | No | Yes (WhatsApp) | No (planned) | V2 |
| Annual plan + discount | Yes | Yes | N/A | Yes | Yes |
| Boleto + PIX + cartão payment | Yes | Yes | N/A | Yes | Yes |
| NF-e issuance | Unknown | Unknown | N/A | Unknown | Yes (required) |
| Pause subscription | No | No | N/A | No | v1.x |
| LGPD deletion flow | Basic | Basic | Unknown | Unknown | Yes (full) |
| PWA | Partial | No | No | Unknown | Yes — full |
| Push notifications | App only | App only | WhatsApp | Unknown | v1.x (VAPID) |

---

## Subscription / Paywall UX — BR-Specific Findings

Based on research into Brazilian SaaS conversion patterns (MEDIUM confidence):

### Trial Length
- 7-day trial: Lower commitment, common in BR market (Organizze, some Mobills tiers)
- 14-day trial: Slightly better activation (user gets full billing cycle experience); recommended
- 30-day trial: Too long for pre-seed; delays validation signal

**Recommendation:** 14-day free trial for paid plan. No credit card required upfront (increases trial starts; accept churn at trial end).

### Annual Discount
- BR norm: 20–30% off vs monthly price
- Display as "save R$X/year" or "equivalent to R$Y/month"
- Show annual as the default/highlighted option

### Payment Methods
- Cartão de crédito: Primary for annual plans (parcelamento in 12×)
- PIX: Growing preference for monthly billing; instant confirmation; low friction
- Boleto bancário: Declining but still expected by significant minority; required to avoid trust loss with older segment of middle class
- Missing any of these = measurable conversion drop in BR

### Churn Mitigation
- "Pause for 1 month" reduces cancellation in tight months (verified pattern in Nubank, Gympass)
- Exit survey at cancellation → primary win-back signal
- "Your data is waiting for you" email at 7 and 30 days post-cancel

### Downgrade UX
- Data must be preserved in read-only mode (not deleted) on downgrade to free
- Show "X months of history visible; upgrade to see full history" rather than hiding it
- Never delete data on downgrade; this is a trust-destroying anti-pattern common in cheaper apps

---

## Sources

- Training data knowledge of Mobills, Organizze, Olivia, Guiabolso, Poup, Visor Finance, Minhas Economias, Monarch Money feature sets (through Aug 2025) — MEDIUM confidence
- Pluggy Open Finance API documentation (training data) — MEDIUM confidence
- Brazilian Open Finance regulation (CMN Resolution 4.949/2021 and BCB normatives) — HIGH confidence
- LGPD (Lei 13.709/2018) Article 18 rights including erasure — HIGH confidence
- PIX ecosystem statistics and classification patterns (BCB public data) — HIGH confidence
- Brazilian SaaS billing patterns (boleto, PIX, parcelamento) — MEDIUM confidence
- WebSearch and WebFetch tools denied; all findings are from training data — flag for validation before roadmap lock

**Note:** Recommend validating Visor Finance current pricing page, Mobills current feature set, and Pluggy webhook/item status documentation directly before roadmap phase planning.

---

*Feature research for: Portal Finance — Brazilian personal finance PWA, middle-class segment*
*Researched: 2026-04-22*
