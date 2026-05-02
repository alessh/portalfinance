---
phase: 2
slug: pluggy-ingestion
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-01
inherits_tokens_from: 01-UI-SPEC.md
---

# Phase 2 — UI Design Contract: Pluggy Ingestion

> Visual and interaction contract for Phase 2. Consumed by gsd-ui-checker, gsd-planner, and gsd-executor.
> All design tokens (colors, typography, spacing, radius, shadows) are INHERITED from `01-UI-SPEC.md` without change.
> This document specifies Phase 2 ADDITIONS ONLY: new components, new copywriting, new interaction patterns.
> The executor MUST read `01-UI-SPEC.md` first and apply its token decisions throughout.

---

## Design System

| Property | Value | Source |
|----------|-------|--------|
| Tool | shadcn/ui (CLI copy-in) | Inherited — Phase 1 |
| Preset | New York style, CSS variables, Tailwind 4 | Inherited — Phase 1 |
| Component library | Radix UI (via shadcn/ui primitives) | Inherited — Phase 1 |
| Icon library | `lucide-react` | Inherited — Phase 1 |
| Font | Inter Variable (`next/font/google`) | Inherited — Phase 1 |
| Widget SDK | `react-pluggy-connect@2.12` | CONTEXT.md D-39 |

**Token inheritance:** All CSS custom properties (--background, --foreground, --primary, --card, --border, --ring, etc.), the teal-scale palette, warm-gray palette, semantic colors (success/warning/danger/info), and the 60/30/10 split are locked from Phase 1. Phase 2 introduces no new tokens.

---

## Spacing Scale

Inherited from Phase 1 (8-point grid, Tailwind 4 defaults). No new spacing tokens.

| Token | Value | Tailwind | Usage in Phase 2 |
|-------|-------|----------|-----------------|
| xs | 4px | `p-1` / `gap-1` | Chip-to-text gap (Transferência/Pagamento de fatura chips), inline badge padding |
| sm | 8px | `p-2` / `gap-2` | Transaction row internal padding, status pill padding |
| md | 16px | `p-4` / `gap-4` | Connection card padding, transaction list row height |
| lg | 24px | `p-6` / `gap-6` | Page section padding, settings card padding |
| xl | 32px | `p-8` / `gap-8` | Connect page card padding |
| 2xl | 48px | `p-12` / `gap-12` | Banner stack total height (2 banners × 48px) |
| 3xl | 64px | `p-16` / `gap-16` | Page-level top/bottom margin on desktop |

**Exceptions (Phase 2 additions):**
- Touch targets: minimum 44×44px inherited from Phase 1. Applied to: Disconnect button, Manual sync button, Reconnect button, month picker chevrons.
- Date group sticky headers on `/transactions`: `h-8` (32px) — compact, not a touch target.
- Transaction row minimum height: `min-h-[56px]` — tappable row height on mobile. Pending chip and sub-metadata fit in two-line layout within this height.
- Status pill: 24px height (`h-6`), 8px horizontal padding (`px-2`). Not a touch target (no action).
- `<ReAuthBanner>` height: 48px (`h-12`) — matches `<EmailVerificationNagBanner>` from Phase 1.

---

## Typography

Inherited from Phase 1. No new sizes or weights.

| Role | Size | Weight | Line Height | Phase 2 Usage |
|------|------|--------|-------------|---------------|
| display | 28px / `text-2xl` | 600 semibold | 1.2 | `/connect/success` "Sincronizando..." headline |
| heading | 20px / `text-xl` | 600 semibold | 1.3 | `/connect` consent page title, `/settings/connections` page title, connection card institution name |
| body | 14px / `text-sm` | 400 regular / 600 semibold | 1.5 | Transaction description (400), amount (600 + `tabular-nums`), account name meta (400 muted), button labels (600), month picker label (600), form labels |
| caption | 12px / `text-xs` | 400 regular | 1.4 | Last-synced timestamp, sub-account balance, status execution detail, "Aguarde N min" cooldown text, Pending chip, transfer/fatura chip, page pagination count |

**Currency formatting (inherited):** `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` → `R$ 1.234,56`. Applied to: transaction amounts, account balances. Apply `tabular-nums` Tailwind utility on amount columns.

**Locale:** `lang="pt-BR"` on `<html>` (inherited). Date format: `dd/MM/yyyy`. Relative dates: `date-fns/formatRelative` with `pt-BR` locale (D-25).

---

## Color

Inherited from Phase 1. The 60/30/10 split and accent reserved-for list are extended, not changed.

| Role | Token | Phase 2 Usage |
|------|-------|---------------|
| Dominant (60%) | `--background` | `/connect` page bg, `/transactions` page bg, `/settings/connections` page bg, `/connect/success` page bg |
| Secondary (30%) | `--card` / `--muted` | Connection item cards, transaction date group header bg, month picker dropdown, paywall stub card |
| Accent (10%) | `--primary` (teal-600 `#0D7F7A`) | Primary CTAs only — see extended reserved-for list below |
| Destructive | `--destructive` (red-600) | "Disconnect" confirmation CTA, Disconnect modal confirm button |

**Accent reserved for (Phase 1 list extended — Phase 2 additions in bold):**
1. Primary `Button` (variant: `default`) fill
2. Focused `Input` / `Checkbox` ring
3. Active route indicator in `SideNav`
4. `EmailVerificationNagBanner` "Verificar" CTA button
5. `DemoDashboard` sample-data ribbon left border
6. `ConsentScreen` "Concordar e continuar" primary CTA
7. Text links in body of `ConsentScreen` privacy/terms text
8. **`/connect` page "Concordar e conectar" primary CTA button**
9. **`DemoDashboard` "Conectar banco" ribbon CTA button**
10. **`/connect/success` pulsing progress step indicator dots (active step only)**
11. **Manual sync "Sincronizar agora" button (paid, non-cooldown state)**

Everything else uses gray/neutral tones. Secondary actions use `variant="outline"`.

**Status pill colors (Phase 2 additions — mapped from Pluggy item status enum, D-18):**

| Pluggy Status | Pill Background | Pill Text | Tailwind classes |
|---------------|----------------|-----------|-----------------|
| `UPDATED` (healthy) | `success-bg` | `success-fg` | `bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300` |
| `UPDATING` (syncing) | `info-bg` | `info-fg` | `bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300` |
| `OUTDATED` | `warning-bg` | `warning-fg` | `bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300` |
| `LOGIN_ERROR` | `danger-bg` | `danger-fg` | `bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300` |
| `WAITING_USER_INPUT` | `warning-bg` | `warning-fg` | `bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300` |

**Transaction amount colors:**

| Condition | Color | Tailwind |
|-----------|-------|---------|
| CREDIT (income) | `success-fg` | `text-emerald-700 dark:text-emerald-300` |
| DEBIT (expense) | `--foreground` (not red) | `text-foreground` |
| PENDING status overlay | Dim both with `opacity-60` | `opacity-60` on the amount |

**Rationale for debit color:** Debits are the majority of transactions; coloring them red would make the list feel alarming. Income (CREDIT) in green provides positive signal without making every debit look like an error. Pending transactions are dimmed to signal uncertainty without hiding them.

---

## Layout & Routes

### Phase 2 Routes

| Route | Layout | Mobile behavior |
|-------|--------|----------------|
| `/connect` | Full-page, centered card (same as `AuthShell` pattern) | Full-width, no sidebar |
| `/connect/success` | Full-page, centered card | Full-width, no sidebar |
| `/transactions` | Authenticated shell + top nav | Full-width list, no sidebar |
| `/settings/connections` | Authenticated shell + settings sidebar on desktop | Single column on mobile |

### Authenticated Shell Layout (new for Phase 2)

Phase 2 introduces the first post-auth pages with real data. The shell wraps all authenticated routes except `/connect` and `/connect/success`.

```
┌───────────────────────────────────────────┐
│ [ReAuthBanner - sticky, z-50]             │  48px, z-50 (above email nag)
│ [EmailVerificationNagBanner - sticky, z-40] │  48px, z-40
├───────────────────────────────────────────┤
│ [TopNav - sticky, z-30]                   │  56px
│  Logo | nav links | avatar               │
├───────────────────────────────────────────┤
│ [Page content - scrollable]               │
│  max-w-screen-xl mx-auto px-4 md:px-8    │
└───────────────────────────────────────────┘
```

**Banner stack order (D-37):** ReAuthBanner stacks ABOVE EmailVerificationNagBanner. Both are `position: sticky`. The `<BannerStack>` component renders banners in priority order (highest priority = topmost). The `priority` prop on each banner controls order: re-auth=10, email-verification=5.

**TopNav:** 56px height (`h-14`). Background `--card`. Border bottom `border-b border-border`. Contains: logo (left, 24px height), navigation links (center on desktop, hidden on mobile behind hamburger), user avatar/menu (right). TopNav is outside Phase 2 scope for full implementation — executor adds minimal TopNav shell; full nav is Phase 4.

### Connect Page Layout (`/connect`)

**Primary focal point:** The bottom full-width primary CTA `"Concordar e conectar"` (teal-600) is the visual anchor — placed after the consent review content so the user has read the disclosure and data points before the call to action.

```
┌─────────────────────────────────────────┐
│ [BannerStack if any active banners]     │
├─────────────────────────────────────────┤
│                                         │
│     ┌───────────────────────────────┐   │
│     │  ← Voltar (ghost, left)       │   │
│     │                               │   │
│     │  Institution logo (if reauth) │   │
│     │  "Conectar sua conta bancária"│   │  heading (text-xl)
│     │  [Disclosure paragraph]       │   │  body (text-sm)
│     │  ┌─ CPF field (if first time) │   │
│     │  └─────────────────────────── │   │
│     │  [Data points list]           │   │
│     │  [Legal basis + links]        │   │
│     │  [Collapsible "Detalhes legais"]  │
│     │  [Consent checkbox]           │   │
│     │  "Concordar e conectar"       │   │  primary CTA (full-width)
│     │  "Não conectar agora"         │   │  ghost CTA (full-width)
│     └───────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
Card: max-w-[440px] w-full, same as AuthShell card
```

### Connect Success Page Layout (`/connect/success`)

```
┌─────────────────────────────────────────┐
│                                         │
│     ┌───────────────────────────────┐   │
│     │  [Animated checkmark or       │   │
│     │   progress indicator]         │   │
│     │  "Sincronizando..."           │   │  display (text-2xl, 600)
│     │                               │   │
│     │  Step 1: Conta conectada ✓    │   │  completed = teal dot + strikethrough
│     │  Step 2: Carregando contas... │   │  in-progress = pulsing teal dot
│     │  Step 3: Carregando transações│   │  pending = gray dot
│     │                               │   │
│     │  "Isso pode levar até 1 min." │   │  caption (text-xs, muted)
│     │                               │   │
│     │  [Auto-redirects in N sec]    │   │  caption, muted
│     │  "Ir para transações →"       │   │  ghost link (manual override)
│     └───────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
Card: max-w-[440px] w-full
```

### Transactions Page Layout (`/transactions`)

Mobile-first. Date-grouped list with sticky date headers. No sidebar.

```
┌────────────────────────────────────────────┐
│ [BannerStack]                              │
├────────────────────────────────────────────┤
│ [TopNav]                                   │
├────────────────────────────────────────────┤
│  Transações                   [Month ▾] [Account ▾]  │  page heading + filter row
├────────────────────────────────────────────┤
│  ┌── Hoje  ─────────────────────────────┐  │  sticky date header
│  │  [tx row] Ifood *Pedido   -R$ 45,90  │  │  56px min-height rows
│  │  [tx row] PIX Recebido   +R$ 800,00  │  │  CREDIT rows get success-fg amount
│  └──────────────────────────────────────┘  │
│  ┌── Ontem ─────────────────────────────┐  │
│  │  [tx row] NET Fibra       -R$ 99,90  │  │
│  │  [tx row] Nubank Fatura   -R$120,00  │  │  [Pagamento de fatura] chip
│  └──────────────────────────────────────┘  │
│  ┌── 15 abr ────────────────────────────┐  │
│  │  [tx row] TED Poupança    -R$ 500,00 │  │  [Transferência] chip
│  └──────────────────────────────────────┘  │
│  [Carregar mais] button                    │  center, variant="outline"
└────────────────────────────────────────────┘
```

**Filter row:** Month picker dropdown (current / prev-1 / prev-2 / older — older gated per D-27) + Account filter dropdown (All / {account name per item}). Both rendered as shadcn `Select` components. Filter row is `flex gap-2 px-4 py-3 sticky top-{banner+nav height}`.

**Paywall stub card (free tier, older month selected):**
Replaces transaction list with a `<Card>` containing blurred list behind an overlay:
- Overlay: white/dark semi-transparent (`bg-background/80 backdrop-blur-sm`)
- Centered content: heading "Histórico completo no plano pago" + body + "Ver planos" button → `/settings/billing`

### Settings > Connections Page Layout (`/settings/connections`)

**Primary focal point:** The per-card status pill row is the page's primary visual anchor — health-at-a-glance is the page's reason to exist. The status pill (ATUALIZADO / SINCRONIZANDO / ERRO DE LOGIN) is right-aligned in each card header and uses semantic color to communicate urgency at a glance before the user reads any text.

```
┌────────────────────────────────────────────┐
│ [BannerStack]                              │
├────────────────────────────────────────────┤
│ [TopNav]                                   │
├────────────────────────────────────────────┤
│  Conexões bancárias                        │  page heading (text-xl, 600)
│  "Gerencie suas contas conectadas"         │  subheading (text-sm, muted)
├────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐   │
│  │ [Logo 40px] Itaú Unibanco          │   │  connection card
│  │             [ATUALIZADO ●]          │   │  status pill (right-aligned)
│  │             "Conectado há 3 dias"  │   │  caption
│  │  ▶ Conta Corrente  R$ 1.234,56    │   │  sub-account row (collapsible)
│  │  ▶ Cartão de Crédito R$ 890,00    │   │  balance in caption weight
│  │  ─────────────────────────────    │   │
│  │  [Sincronizar agora]  [Desconectar]│   │  action buttons (outline)
│  │  sincronizado há 12 min           │   │  caption, muted, with tooltip
│  └─────────────────────────────────────┘   │
│                                            │
│  [+ Conectar outro banco]                  │  outline button, full-width on mobile
└────────────────────────────────────────────┘
```

**Connection card:** `<Card className="p-6 mb-4">`. Institution logo: 40×40px, `rounded-full`, `object-contain`, provided by Pluggy CDN URL (`institution_logo_url`). Fallback if no logo: gray circle with institution initials in `text-sm font-semibold`.

**Sub-account list:** collapsible `<details>/<summary>` or Radix Collapsible. Default: expanded on desktop, collapsed on mobile with "Mostrar contas" toggle.

**Action button states (D-28):**

| State | Label | Style |
|-------|-------|-------|
| Paid + healthy + not cooling | "Sincronizar agora" | `variant="outline"` |
| Paid + cooling down | "Aguarde 12 min" | `variant="outline" disabled` + live countdown |
| Free tier | "Sincronizar agora" | `variant="outline"` but click → paywall modal |
| Any item broken | "Reconectar" | `variant="default"` (teal fill — high urgency) |
| Always visible | "Desconectar" | `variant="outline" className="text-destructive border-destructive"` |

---

## Component Contracts

### 3.1 `<ReAuthBanner>`

**Location:** `src/components/banners/ReAuthBanner.tsx`

**Props:**
```tsx
interface ReAuthBannerProps {
  items: Array<{ id: string; institution_name: string }>
  priority?: number  // default: 10 (above email-verification banner's 5)
}
```

**Visual contract:**
- `position: sticky; top: 0; z-index: 50` (one z-level above `EmailVerificationNagBanner`)
- Height: 48px (`h-12`)
- Background: `bg-warning-bg dark:bg-warning-bg-dark` (amber — matches Phase 1 `warning-bg`)
- Left icon: `<AlertTriangle>` 16px `text-warning-fg`
- Text (1 broken item): `"Sua conexão com {institution_name} expirou."`
- Text (2+ broken items): `"Suas conexões com {institution_1} e mais {N} precisam de atenção."`
- CTA (single item): `"Reconectar {institution_name}"` — `text-primary font-semibold underline` — navigates to `/connect?reconnect={item.id}`
- CTA (multiple items): `"Ver conexões"` — `text-primary font-semibold underline` — navigates to `/settings/connections`
- **NOT dismissable** (D-36) — no X button. Persists until `item.status` flips to `UPDATED`.
- `aria-label="Reconexão necessária"` on the banner `<aside>` element
- `role="alert"` on the text span (live region — re-auth is urgent)

**State machine:**
1. Any item in `LOGIN_ERROR` / `WAITING_USER_INPUT` / `OUTDATED` (with error) → banner visible
2. All items resolve to `UPDATED` → banner unmounts

**BannerStack integration:** `<BannerStack>` renders `<ReAuthBanner priority={10} />` before `<EmailVerificationNagBanner priority={5} />`. Stack is `flex flex-col` — both banners display when both conditions are active.

---

### 3.2 `<ConsentScreen>` — Phase 2 Extension

**Location:** Existing `src/components/consent/ConsentScreen.tsx` — extended, not replaced.

**New scope variants (add to discriminated union):**

```tsx
type ConsentScope =
  | 'ACCOUNT_CREATION'
  | 'PLUGGY_CONNECT_PENDING'
  | `PLUGGY_CONNECTOR:${string}`
```

**`PLUGGY_CONNECT_PENDING` scope config:**
```
title: "Conectar sua conta bancária"
dataPoints: [
  "Dados de conta: saldos e informações da conta",
  "Transações: histórico de movimentações financeiras (até 12 meses)",
  "Dados de produto: limites de cartão e datas de vencimento"
]
disclosure: "Você está autorizando a Portal Finance a receber suas transações, saldos e detalhes da conta do seu banco através da Pluggy. Você pode revogar a qualquer momento em Configurações > Conexões."
legalBasis: "Base legal: Art. 7º, I da LGPD (consentimento)"
collapsibleDetails: "Detalhes legais"  // expands to LGPD Arts. 7º, 8º, 9º citations
```

**CPF field (Phase 2 addition — only rendered when `users.cpf_hash` is null):**
- Field appears between the data-points list and the consent checkbox
- Label: `"Seu CPF"` — `FormLabel`
- Input: `type="text"`, `inputmode="numeric"`, `autocomplete="off"`, placeholder `"000.000.000-00"`, mask applied client-side
- Inline error (D-06): `"CPF inválido. Verifique os dígitos e tente novamente."`
- Validation: client-side first via `lib/cpf.ts` `isValidCPF()`, then server-side on submit
- CPF field is hidden when the user already has a CPF on file (server passes `hasCpf: boolean` prop)

**CTA label override for Phase 2:** When scope is `PLUGGY_CONNECT_PENDING`, primary CTA = `"Concordar e conectar"` (not "Concordar e continuar" as in Phase 1). Add `ctaLabel` prop to `ConsentScreen` or derive from scope config.

---

### 3.3 `<PluggyConnectWidget>`

**Location:** `src/components/connect/PluggyConnectWidget.tsx`

**Purpose:** Thin wrapper around `react-pluggy-connect@2.12` `<PluggyConnect>` component. Keeps all Pluggy widget logic isolated.

**Props:**
```tsx
interface PluggyConnectWidgetProps {
  connectToken: string
  reconnectItemId?: string    // internal UUID, not Pluggy item id
  onSuccess: (itemId: string, connectorId: number) => void
  onError: (error: PluggyError) => void
  onClose: () => void
}
```

**Visual contract:**
- The `<PluggyConnect>` component renders Pluggy's hosted iframe — styling is Pluggy's responsibility inside the iframe
- Our wrapper renders a full-screen overlay (`fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm`) while the widget loads
- Loading state (before iframe ready): centered `<Loader2 className="animate-spin h-8 w-8 text-primary" />`
- On `onClose` (user dismissed without connecting): navigate back to `/connect` and show toast: `"Conexão cancelada. Tente novamente quando estiver pronto."`
- On `onError`: show Sonner error toast with appropriate copy (see copywriting contract)
- The widget iframe is never rendered while `connectToken` is empty — guard with loading state

**Reconnect mode:** When `reconnectItemId` is provided, render the widget with `updateItem={reconnectItemId}` prop (Pluggy update mode). The consent screen is NOT shown again in reconnect mode — user is sent directly to the widget via the reconnect deep-link.

---

### 3.4 `<ConnectSuccessPage>`

**Location:** `src/app/connect/success/page.tsx` + `src/components/connect/SyncProgressCard.tsx`

**Polling behavior (D-03):** Calls `GET /api/sync-status` every 2 seconds. On first `transactions_count > 0` response or after 60 seconds → redirect to `/transactions`.

**Progress step states:**

```tsx
type StepStatus = 'pending' | 'in-progress' | 'completed' | 'error'

steps: [
  { label: 'Conta conectada', status: 'completed' },      // always completed on this page
  { label: 'Carregando contas...', status: 'in-progress' | 'completed' },
  { label: 'Carregando transações...', status: 'pending' | 'in-progress' | 'completed' },
]
```

**Step visual:**
- `completed`: teal filled circle `●` + text `text-success-fg`
- `in-progress`: pulsing teal ring + spinner (`animate-pulse bg-primary rounded-full h-3 w-3`)
- `pending`: gray unfilled circle `○` + text `text-muted-foreground`
- `error`: `<AlertTriangle>` amber icon + text `text-warning-fg`

**Timeout state (60s elapsed, no transactions):**
- Step 3 goes to `error` state
- Body: `"Está demorando mais do que o esperado. Suas transações aparecerão em breve."`
- CTA changes from ghost to primary: `"Ir para transações →"` (no longer a manual override link — now the primary action)

---

### 3.5 `<TransactionList>`

**Location:** `src/components/transactions/TransactionList.tsx`

**Props:**
```tsx
interface TransactionListProps {
  transactions: Transaction[]
  isLoading: boolean
  emptyState: 'no-items' | 'syncing' | 'no-transactions'
  hasMore: boolean
  onLoadMore: () => void
}
```

**Transaction row contract:**

```
┌──────────────────────────────────────────────────────────┐
│  [account-color-dot] Description text          +R$ 800  │  min-h-[56px]
│                       Account name             Pendente  │  chips and meta, text-xs muted
└──────────────────────────────────────────────────────────┘
```

- **Left side:** account color dot (4px circle, tinted from account name hash — see below) + description (`text-sm` 400, `text-foreground`, truncate with `truncate max-w-[60%]`)
- **Right side:** amount (`text-sm` 600, `tabular-nums`; CREDIT = `text-success-fg`, DEBIT = `text-foreground`) + chips below amount
- **Bottom of row (meta line):** account name (`text-xs text-muted-foreground`) + chips inline

**Account color dot:** Deterministic color from `hashColor(account.name)` — cycles through 6 muted non-teal palette colors (slate-400, violet-400, orange-400, sky-400, pink-400, lime-400). Consistent per account across sessions. 8px diameter (`h-2 w-2 rounded-full`). Purpose: visual grouping aid on the list without a separate column.

**Chips (Phase 2, D-31):**

| Chip | Background | Text | When shown |
|------|-----------|------|-----------|
| `Pendente` | `warning-bg` | `warning-fg` | `status='PENDING'` |
| `Transferência` | `--muted` | `--muted-foreground` | `is_transfer=true` |
| `Pagamento de fatura` | `--muted` | `--muted-foreground` | `is_credit_card_payment=true` |

Chip style: `text-xs px-2 py-1 rounded-sm font-medium` (4px vertical padding — 8-point grid compliant).

**Date group sticky headers:**
- `position: sticky; top: {banner+nav+filter height}` — calculate dynamically via CSS custom property `--sticky-offset`
- Height: 32px (`h-8`)
- Background: `--muted` (slight tint to separate from rows)
- Text: `text-xs font-semibold text-muted-foreground uppercase tracking-wide`
- Labels: `"Hoje"`, `"Ontem"`, `"15 abr"` (day + month abbreviated in pt-BR, `date-fns/format` with `pt-BR` locale, pattern `'d MMM'`)

**"Carregar mais" button:**
- `variant="outline"`, full-width on mobile, `min-w-[200px]` centered on desktop
- While loading next page: `disabled` + `<Loader2 className="animate-spin h-4 w-4 mr-2" />` prefix

---

### 3.6 Empty State Components

**Location:** `src/components/transactions/EmptyTransactions.tsx`

Three distinct empty states per D-24. Each renders a centered card (`max-w-sm mx-auto text-center py-16`).

**Empty state A — No items connected:**
- Icon: `<Landmark>` from lucide-react, 48px, `text-muted-foreground`
- Heading: `"Nenhuma conta conectada"` (`text-xl font-semibold`)
- Body: `"Conecte seu banco para ver suas transações automaticamente."` (`text-sm text-muted-foreground mt-2`)
- CTA: `"Conectar meu banco"` → `/connect`, `variant="default"`, `className="mt-6"`

**Empty state B — Syncing (items connected, no transactions yet):**
- Icon: `<Loader2 className="animate-spin h-12 w-12 text-primary">` (spinner, functional — not decorative)
- Heading: `"Buscando suas transações..."` (`text-xl font-semibold`)
- Body: `"Isso pode levar até 1 minuto. A página atualiza automaticamente."` (`text-sm text-muted-foreground mt-2`)
- Last-sync timestamp: `"Última tentativa: há 23 seg"` (`text-xs text-muted-foreground mt-4`)
- Secondary CTA: `"Voltar para o início"` → `/`, `variant="ghost"`, `className="mt-4"`

**Empty state C — Zero transactions in selected month:**
- Icon: `<CalendarOff>` 48px, `text-muted-foreground`
- Heading: `"Sem transações em {Mês}"` — month from selected filter, e.g., `"Sem transações em abril"` (`text-xl font-semibold`)
- Body: `"Nenhuma transação encontrada para esse período e conta selecionados."` (`text-sm text-muted-foreground mt-2`)
- CTA: `"Mudar mês"` — opens month picker dropdown, `variant="outline"`, `className="mt-6"`

---

### 3.7 `<ConnectionCard>`

**Location:** `src/components/connections/ConnectionCard.tsx`

Full contract described in Layout section above. Additional detail:

**Last-synced timestamp (D-25):**
- Default text: `"sincronizado há {N} min"` or `"sincronizado há {N} h"` — via `date-fns/formatDistanceToNow` with `pt-BR` locale + `addSuffix: false` then manually append `"sincronizado há"` prefix
- On hover (desktop) / long-press (mobile): `<Tooltip>` showing absolute timestamp in `"15 abr 2026 14:23 BRT"` format
- Tooltip: shadcn `<Tooltip>` + `<TooltipContent>` — add to Phase 2 shadcn component list

**Syncing animation (D-21):**
- Status `UPDATING`: replace status pill with `<span className="inline-flex items-center gap-2 text-xs text-blue-700"><span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" /> Sincronizando...</span>`
- Gap between dot and label: `gap-2` (8px — 8-point grid compliant)
- CSS `animate-pulse` (Tailwind default, 2s ease-in-out) — not a spinner (per D-21 rationale)
- Respects `prefers-reduced-motion`: wrap with `motion-safe:animate-pulse`

**Disconnect button (D-04):**
- Always visible, `variant="outline"` with destructive border and text: `className="border-destructive text-destructive hover:bg-destructive/10"`
- Opens `<DisconnectConfirmModal>` (see 3.8 below)

---

### 3.8 `<DisconnectConfirmModal>`

**Location:** `src/components/connections/DisconnectConfirmModal.tsx`

**Built on:** shadcn `<Dialog>` (same pattern as Phase 1 `ConfirmDestructiveModal`)

**Props:**
```tsx
interface DisconnectConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  institutionName: string
  onConfirm: () => void
  isConfirming: boolean
}
```

**Visual contract:**
- `<DialogTitle>`: `"Desconectar {institutionName}?"`
- `<DialogDescription>`:
  > "Ao desconectar: (a) a sincronização será interrompida; (b) o histórico de transações será mantido; (c) para sincronizar novamente, será necessário uma nova conexão e consentimento."
- Typed confirmation: input field `placeholder="Digite DISCONNECT para confirmar"` — confirm button enables only when user types `DISCONNECT` exactly (uppercase enforced, no trim)
- Confirm button: `"Desconectar"`, `variant="destructive"`, disabled until typed confirmation matches
- Cancel button: `"Manter conexão"` — `variant="ghost"` — `cancelLabel` per Phase 1 `ConfirmDestructiveModal` pattern (noun-qualified cancel label, never generic "Cancelar")
- Focus on open: lands on cancel button (safer default — mirrors Phase 1 `ConfirmDestructiveModal` pattern)
- On confirm: calls `DELETE /api/pluggy/items/:id`, shows `<Loader2>` in button, redirects to `/settings/connections` with toast: `"Conexão com {institutionName} encerrada."`

---

### 3.9 `<PaywallStubCard>`

**Location:** `src/components/billing/PaywallStubCard.tsx`

**Usage:** Rendered in two contexts: (a) `/transactions` older-month paywall, (b) `/connect` free-tier 2nd-item block.

**Context A — transactions paywall (D-27):**
- Overlays the transaction list with `bg-background/80 backdrop-blur-sm` + blurred list behind
- Centered content:
  - Icon: `<Lock>` 32px, `text-muted-foreground`
  - Heading: `"Histórico completo disponível no plano pago"` (`text-lg font-semibold`)
  - Body: `"Assine o plano pago para acessar todo o histórico de transações."` (`text-sm text-muted-foreground mt-2`)
  - CTA: `"Ver planos"` → `/settings/billing`, `variant="default"`, `className="mt-6"`

**Context B — 2nd item block on `/connect` (D-49):**
- Replaces the entire `/connect` page card content (widget never opens)
- Icon: `<Lock>` 32px, `text-muted-foreground`
- Heading: `"Plano gratuito limitado"` (`text-lg font-semibold`)
- Body: `"Conexões adicionais e sincronização manual estão disponíveis no plano pago. Cancele quando quiser."` (`text-sm text-muted-foreground mt-2`)
- CTA: `"Ver planos"` → `/settings/billing`, `variant="default"`, `className="mt-6"`
- Secondary: `"Voltar para o dashboard"` → `/`, `variant="ghost"`, `className="mt-2"`

---

### 3.10 New shadcn Components (Phase 2 Additions)

Executor runs `npx shadcn@latest add {component}` for each. All not yet installed:

| Component | CLI command | Usage |
|-----------|------------|-------|
| `Select` | `npx shadcn@latest add select` | Month picker, account filter dropdown on `/transactions` |
| `Tooltip` | `npx shadcn@latest add tooltip` | Last-synced absolute timestamp on hover |
| `Collapsible` | `npx shadcn@latest add collapsible` | Sub-account list expand/collapse on connection card |
| `Progress` | `npx shadcn@latest add progress` | Sync progress bar on `/connect/success` (fallback if step list is insufficient) |

**Already installed (Phase 1):** `button`, `input`, `form`, `checkbox`, `card`, `alert`, `dialog`, `sonner`, `badge`, `separator`.

---

## Accessibility

### Phase 2 Additions

**`<ReAuthBanner>`:**
- `<aside aria-label="Reconexão necessária">` — landmark
- `role="alert"` on the message text — urgent live region
- CTA link has `aria-label="Reconectar {institution_name}"` (single-item) or `aria-label="Ver conexões"` (multi-item) — always noun-qualified for screen readers

**`<TransactionList>` rows:**
- Each row is a `<li>` inside a `<ul>` per date group
- Date group headers are `<h2>` (not `<div>`) semantically, visually styled as captions
- Amount: `aria-label="Valor: R$ 1.234,56 crédito"` / `"débito"` — screen readers announce the transaction type with the amount
- Chips: `aria-label="Pendente"` / `"Transferência"` / `"Pagamento de fatura"` on the badge `<span>`

**`<DisconnectConfirmModal>`:**
- `<DialogTitle>` and `<DialogDescription>` mandatory (same requirement as Phase 1)
- Typed confirmation input: `aria-label="Campo de confirmação — digite DISCONNECT"`, `aria-required="true"`
- Confirm button: `aria-disabled="true"` when typed text doesn't match (not `disabled` — allows focus for screen readers)

**`<ConnectionCard>` status pill:**
- Each pill has an accessible `aria-label` including the full status: `aria-label="Status: Atualizado"` / `"Sincronizando"` / `"Erro de login — reconexão necessária"` / `"Aguardando ação do usuário"`

**`<PluggyConnectWidget>` overlay:**
- `aria-label="Carregando widget de conexão bancária"` on the overlay `<div>`
- `role="status"` on loading spinner container

**Keyboard navigation:**
- `/transactions` filter row: Tab reaches month picker, then account picker; Enter opens dropdown
- `/settings/connections` card: Tab order: status pill (read-only, `tabindex="-1"`), sub-account toggle, Sync button, Disconnect button
- `<DisconnectConfirmModal>`: focus trap (Radix `<Dialog>` handles), focus on cancel button on open

### WCAG AA additions

All Phase 1 contrast ratios inherited. New combinations:

| Foreground | Background | Ratio | AA Pass |
|------------|-----------|-------|---------|
| `success-fg` (`#0F766E`) | `--background` (`#F8FAFA`) | 4.5:1 | Pass (AA, barely — only use at 14px+ not 12px captions) |
| `warning-fg` (`#B45309`) | `warning-bg` (`#FEF3C7`) | 4.9:1 | Pass |
| `danger-fg` (`#B91C1C`) | `danger-bg` (`#FEE2E2`) | 5.3:1 | Pass |
| `text-blue-700` (#1D4ED8) | `blue-100` (`#DBEAFE`) | 4.7:1 | Pass — UPDATING pill |
| `text-foreground` (`#334848`) | `--muted` (`~#E8F0F0`) | 5.8:1 | Pass — date group headers |

**Note on `success-fg` at 12px:** `#0F766E` on white at 12px (`text-xs`) = 4.5:1, which is AA for large text (18pt/14pt bold) but borderline for normal text. At `text-xs` (12px/400), use `text-emerald-700` (`#047857`) at 5.3:1 instead for CREDIT amounts in caption contexts.

---

## Motion

Inherited from Phase 1. Phase 2 additions:

| Usage | Duration | Easing | Tailwind |
|-------|----------|--------|---------|
| Sync status pulse (UPDATING dot) | 2000ms | ease-in-out | `animate-pulse` (Tailwind default) |
| ReAuthBanner mount | 200ms | ease-out | `animate-in slide-in-from-top-2` (Tailwind animate-in plugin) |
| Progress step completion | 300ms | ease-out | `transition-colors duration-300` on step dot |
| Connect success redirect | Instant (no animation) | — | `router.push()` |
| Transaction list page load skeleton | 150ms fade | ease-out | `animate-pulse` on skeleton rows |
| Disconnect modal open | 200ms | ease-out | Radix default `data-[state=open]:` |
| Paywall overlay reveal | 200ms | ease-out | `transition-opacity duration-200` |
| Cooldown countdown tick | Instant | — | No animation — plain text update every 60s |

**Reduced motion:** All `animate-pulse` usages must be wrapped in `motion-safe:animate-pulse`. UPDATING dot becomes a static blue dot at `prefers-reduced-motion: reduce`. Sync spinner in empty state B: spinner is functional — exempt (same rationale as Phase 1 `<Loader2>`).

---

## Copywriting Contract (pt-BR)

Tone: clear, adult, direct, plain voice. Same as Phase 1. Never patronizing. LGPD terms stated plainly.

### Connect Flow

| Element | Copy |
|---------|------|
| `/connect` page heading | `"Conectar sua conta bancária"` |
| `/connect` disclosure text | `"Você está autorizando a Portal Finance a receber suas transações, saldos e detalhes da conta do seu banco através da Pluggy. Você pode revogar a qualquer momento em Configurações > Conexões."` |
| Data point 1 | `"Saldos e detalhes da conta"` |
| Data point 2 | `"Histórico de transações (até 12 meses)"` |
| Data point 3 | `"Limites e datas de vencimento do cartão"` |
| Legal basis | `"Base legal: Art. 7º, I da LGPD (consentimento)"` |
| Collapsible trigger | `"Detalhes legais"` |
| Consent checkbox | `"Estou ciente e concordo com o tratamento dos meus dados financeiros conforme descrito acima e na [Política de Privacidade]."` |
| Primary CTA | `"Concordar e conectar"` |
| Cancel CTA | `"Não conectar agora"` |
| Reconnect heading | `"Reconectar {Institution Name}"` |
| Reconnect disclosure | `"Sua conexão com {Institution Name} expirou. Reconecte para retomar a sincronização automática."` |
| Reconnect CTA | `"Reconectar"` |
| CPF field label | `"Seu CPF"` |
| CPF placeholder | `"000.000.000-00"` |

### Connect Success

| Element | Copy |
|---------|------|
| Page heading | `"Sincronizando..."` |
| Step 1 (always completed) | `"Conta conectada"` |
| Step 2 | `"Carregando contas..."` |
| Step 3 | `"Carregando transações..."` |
| Patience note | `"Isso pode levar até 1 minuto."` |
| Auto-redirect note | `"Você será redirecionado automaticamente."` |
| Manual override link | `"Ir para transações →"` |
| Timeout state body | `"Está demorando mais do que o esperado. Suas transações aparecerão em breve."` |
| Timeout CTA | `"Ir para transações →"` |

### Transactions Page

| Element | Copy |
|---------|------|
| Page heading | `"Transações"` |
| Month filter label | `"Mês"` |
| Account filter label | `"Conta"` |
| Account filter "all" option | `"Todas as contas"` |
| Month option current | `"Maio 2026"` (dynamic) |
| Load more button | `"Carregar mais"` |
| Loading state | `"Carregando..."` (on Carregar mais button) |
| Date header "today" | `"Hoje"` |
| Date header "yesterday" | `"Ontem"` |
| Date header other | `"15 abr"` (pattern: `d MMM`, pt-BR locale) |

### Settings > Connections

| Element | Copy |
|---------|------|
| Page heading | `"Conexões bancárias"` |
| Page subheading | `"Gerencie suas contas conectadas"` |
| Add connection button | `"+ Conectar outro banco"` |
| Sync button (active) | `"Sincronizar agora"` |
| Sync button (cooling) | `"Aguarde {N} min"` |
| Sync tooltip | `"A Pluggy permite uma sincronização manual a cada 30 minutos para evitar sobrecarga."` |
| Disconnect button | `"Desconectar"` |
| Connected since | `"Conectado há {N} dias"` |
| Last synced | `"sincronizado há {N} min"` |
| Last synced absolute (tooltip) | `"15 abr 2026 14:23 BRT"` |
| Sub-account expand | `"Mostrar contas ({N})"` |
| Sub-account collapse | `"Ocultar contas"` |
| Balance label | `"Saldo:"` |
| Credit limit label | `"Limite:"` |

### Disconnect Modal

| Element | Copy |
|---------|------|
| Modal title | `"Desconectar {institutionName}?"` |
| Modal body | `"Ao desconectar: (a) a sincronização será interrompida imediatamente; (b) seu histórico de transações será mantido; (c) para sincronizar novamente, será necessário uma nova conexão e consentimento."` |
| Type-in placeholder | `"Digite DISCONNECT para confirmar"` |
| Confirm button | `"Desconectar"` |
| Cancel button | `"Manter conexão"` (noun-qualified — not "Cancelar") |
| Success toast | `"Conexão com {institutionName} encerrada."` |

### Re-auth Banner

| Element | Copy |
|---------|------|
| Single item | `"Sua conexão com {institution_name} expirou."` |
| Multiple items (2+) | `"Suas conexões com {institution_1} e mais {N} precisam de atenção."` |
| Banner CTA (single item) | `"Reconectar {institution_name}"` (dynamic — noun-qualified with institution name) |
| Banner CTA (multiple items) | `"Ver conexões"` |

### Error States & Validation

| Error | Copy |
|-------|------|
| CPF invalid | `"CPF inválido. Verifique os dígitos e tente novamente."` |
| Widget closed without connecting | `"Conexão cancelada. Tente novamente quando estiver pronto."` |
| Cooldown active | `"Aguarde {N} minutos para sincronizar novamente."` |
| Pluggy 429 (rate limit) | `"Estamos com tráfego alto. Tente novamente em alguns minutos."` |
| Item LOGIN_ERROR | `"Sua conexão com {Banco} expirou. Reconecte para continuar."` |
| Pluggy widget generic error | `"Não foi possível conectar. Tente novamente ou entre em contato com o suporte."` |
| Sync failed | `"Não foi possível sincronizar agora. Tentaremos novamente automaticamente."` |
| Disconnect failed | `"Não foi possível desconectar. Tente novamente ou entre em contato com o suporte."` |
| Connect token expired | `"Sua sessão de conexão expirou. Inicie o processo novamente."` |
| Generic server error | `"Algo deu errado. Tente novamente em instantes."` (inherited from Phase 1) |

### Paywall Stubs

| Element | Copy |
|---------|------|
| Transactions paywall heading | `"Histórico completo disponível no plano pago"` |
| Transactions paywall body | `"Assine o plano pago para acessar todo o histórico de transações."` |
| Transactions paywall CTA | `"Ver planos"` |
| 2nd item block heading | `"Plano gratuito limitado"` |
| 2nd item block body | `"Conexões adicionais e sincronização manual estão disponíveis no plano pago. Cancele quando quiser."` |
| 2nd item block CTA | `"Ver planos"` |
| 2nd item back link | `"Voltar para o dashboard"` |

### Re-auth Email (React Email Template `ReAuthRequired.tsx`)

| Element | Copy |
|---------|------|
| Email subject | `"Reconecte seu {Institution Name}"` |
| Email heading | `"Sua conexão com {Institution Name} precisa ser renovada"` |
| Email body | `"Última sincronização bem-sucedida: {last_synced_at formatted}. Para continuar recebendo atualizações automáticas das suas transações, reconecte sua conta."` |
| Email CTA | `"Reconectar agora"` |
| Email footer | `"Responda este e-mail para obter suporte. Este e-mail foi enviado por Portal Finance, {address}."` |
| Plaintext alternate | Required — same content, no HTML (per D-35 + Phase 1 plan 01-05 lockdown) |

---

## Radii & Shadows

Inherited from Phase 1. No new tokens. Phase 2 usage:

| Token | Value | Phase 2 Usage |
|-------|-------|---------------|
| radius-sm | 4px (`rounded-sm`) | Transaction chips (Pendente, Transferência, Pagamento de fatura), status pills |
| radius-md | 6px (`rounded-md`) | Filter dropdowns (Select), Tooltip, Sync button, Disconnect button |
| radius-lg | 8px (`rounded-lg`) | ReAuthBanner (no radius — flush strip), Sonner toasts |
| radius-xl | 12px (`rounded-xl`) | Connection cards, Connect page card, success page card, paywall stub card |
| radius-full | 9999px (`rounded-full`) | Institution logo circle fallback, account color dot, UPDATING pulse dot |

| Shadow | Token | Phase 2 Usage |
|--------|-------|---------------|
| Elevation 1 | `shadow-sm` | Connection card default |
| Elevation 2 | `shadow-md` | Connect page card, success card |
| Elevation 3 | `shadow-lg` | Disconnect modal, paywall overlay |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | button, input, form, checkbox, card, alert, dialog, sonner, badge, separator (Phase 1) + select, tooltip, collapsible, progress (Phase 2) | Not required (official registry) |
| Third-party | none | Not applicable |

`react-pluggy-connect@2.12` is an npm package (not a shadcn registry block). No shadcn registry vetting applies. Pluggy SDK is the official integration path per CONTEXT.md D-39.

---

## Pre-Population Traceability

| Field / Section | Source |
|-----------------|--------|
| All design tokens (colors, typography, spacing, radii, shadows) | 01-UI-SPEC.md (locked, inherited) |
| shadcn component set base | 01-UI-SPEC.md § 2.12 |
| Widget SDK: `react-pluggy-connect@2.12` | CONTEXT.md D-39 |
| `/connect` as canonical entry point | CONTEXT.md D-01 |
| CPF inline on consent screen | CONTEXT.md D-02 |
| `/connect/success` with 2s polling, 60s timeout | CONTEXT.md D-03 |
| Disconnect = 2-step typed confirmation (`DISCONNECT`) | CONTEXT.md D-04 |
| Pluggy handles connector picker | CONTEXT.md D-05 |
| CPF validation client-first, inline error | CONTEXT.md D-06 |
| Connect flow two consent rows | CONTEXT.md D-08 |
| `/settings/connections` as item-health page | CONTEXT.md D-17 |
| Status pill taxonomy (UPDATED/UPDATING/etc.) | CONTEXT.md D-18 |
| Raw description text (no transformation) | CONTEXT.md D-19 |
| Account balance shown per sub-account | CONTEXT.md D-20 |
| Pulsing blue dot for UPDATING (no spinner) | CONTEXT.md D-21 |
| 50 transactions per page, "Carregar mais" | CONTEXT.md D-22 |
| Pending chip inline, pending excluded from totals | CONTEXT.md D-23 |
| Three empty states on `/transactions` | CONTEXT.md D-24 |
| Last-synced relative + absolute on hover/long-press | CONTEXT.md D-25 |
| Free tier older-month paywall card with blur | CONTEXT.md D-27 |
| Paid sync button: active / cooldown countdown states | CONTEXT.md D-28 |
| Free tier sync button → paywall modal | CONTEXT.md D-29 |
| Transfer/fatura chips inline in main feed | CONTEXT.md D-31 |
| No flag-override UI in Phase 2 | CONTEXT.md D-32 |
| Re-auth email timing and content | CONTEXT.md D-34, D-35 |
| Re-auth banner: persistent, not dismissable | CONTEXT.md D-36 |
| Banner stack: re-auth above email-verification | CONTEXT.md D-37 |
| Connect page month/account filters only | CONTEXT.md D-16 |
| Consent disclosure copy (pt-BR plain voice) | CONTEXT.md D-14 |
| Free-tier 2nd connect → paywall before widget opens | CONTEXT.md D-49 |
| Paywall stub copy | CONTEXT.md Specifics section |
| Error message copy (CPF, cooldown, 429, etc.) | CONTEXT.md Specifics section |
| Reconnect deep-link: `/connect?reconnect={uuid}` | CONTEXT.md D-12 |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
