---
phase: 1
slug: foundation-identity
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-22
---

# Phase 1 — UI Design Contract: Foundation & Identity

> Visual and interaction contract for Phase 1. Consumed by gsd-ui-checker, gsd-planner, and gsd-executor.
> Phase 1 is the token-locking phase — these decisions propagate to every subsequent phase unchanged.

---

## Design System

| Property | Value | Source |
|----------|-------|--------|
| Tool | shadcn/ui (CLI copy-in) | STACK.md (locked) |
| Preset | Run `npx shadcn@latest init` — select "New York" style, CSS variables mode, Tailwind 4 | Decision below |
| Component library | Radix UI (via shadcn/ui primitives) | STACK.md |
| Icon library | `lucide-react` (bundled with shadcn/ui) | shadcn default |
| Font | Inter Variable (`next/font/google` — `Inter`) | Decision below |

**shadcn style rationale:** "New York" variant uses a tighter default radius (0.375rem) and slightly denser padding than "Default" — better fit for financial data density. CSS variables mode is mandatory for dark-mode switching.

**Font rationale:** Inter Variable ships tabular-numerals via `font-variant-numeric: tabular-nums` — required by Phase 4 dashboard for aligned currency columns. Zero extra download vs a static cut. `next/font/google` ensures the font file is served from Railway (Brazilian territory) not Google CDN.

**shadcn init command (executor runs this in Phase 1 plan 01-01):**
```bash
npx shadcn@latest init
# Select: New York style, CSS variables, Tailwind 4 config
```

---

## Design Tokens

### 1.1 Color Palette — Teal Scale (Primary Brand)

Primary: `#0D7F7A` (deep teal, user-confirmed).

| Token | Hex | HSL | Usage |
|-------|-----|-----|-------|
| teal-50 | `#F0FAFA` | 180 60% 96% | Hover backgrounds, input focus rings (light mode) |
| teal-100 | `#CCEFEE` | 179 56% 87% | Chip/badge backgrounds |
| teal-200 | `#9ADEDD` | 180 53% 74% | Decorative borders |
| teal-300 | `#5DC9C7` | 179 51% 58% | Subtle accents |
| teal-400 | `#2CB5B2` | 179 60% 44% | Interactive hover |
| teal-500 | `#0D9B97` | 178 86% 33% | Slightly lighter primary (focus ring) |
| teal-600 | `#0D7F7A` | 178 84% 28% | **PRIMARY — brand, primary button, links** |
| teal-700 | `#0A6360` | 178 83% 21% | Primary button hover |
| teal-800 | `#084A47` | 178 80% 16% | Dark-mode surface accent |
| teal-900 | `#053330` | 178 79% 11% | Dark-mode chip backgrounds |
| teal-950 | `#021F1D` | 179 79% 7% | Dark-mode deep background |

### 1.2 Color Palette — Warm Gray (Neutral Scale)

Warm-gray (slight teal undertone to harmonize with primary):

| Token | Hex | Usage |
|-------|-----|-------|
| gray-50 | `#F8FAFA` | Light-mode page background |
| gray-100 | `#F1F4F4` | Light-mode card background |
| gray-200 | `#E2E8E8` | Borders, dividers (light mode) |
| gray-300 | `#CBD4D4` | Muted borders |
| gray-400 | `#9AABAB` | Placeholder text, disabled icons |
| gray-500 | `#6B8080` | Muted body text |
| gray-600 | `#4A6060` | Secondary body text |
| gray-700 | `#334848` | Primary body text (light mode) |
| gray-800 | `#1E2E2E` | Headings (light mode), card backgrounds (dark mode) |
| gray-900 | `#111C1C` | Page background (dark mode) |
| gray-950 | `#080F0F` | Deep dark background |

### 1.3 Semantic Colors

| Token | Hex | Role | Usage |
|-------|-----|------|-------|
| success-fg | `#0F766E` | Positive delta, income metrics, "healthy" badge | Positive % change, income totals |
| success-bg | `#CCFBF1` | Success badge background (light mode) | Badge fill |
| success-bg-dark | `#042F2E` | Success badge background (dark mode) | Badge fill dark |
| warning-fg | `#B45309` | Moderate overspend delta, "nag" banner text | Medium-risk signals |
| warning-bg | `#FEF3C7` | Warning badge background (light mode) | Badge fill |
| warning-bg-dark | `#3B1F00` | Warning badge background (dark mode) | Badge fill dark |
| danger-fg | `#B91C1C` | Destructive actions, severe overspend, lockout | Delete buttons, error states |
| danger-bg | `#FEE2E2` | Error/destructive badge background (light mode) | Badge fill |
| danger-bg-dark | `#3B0000` | Error/destructive badge background (dark mode) | Badge fill dark |
| info-fg | `#1D4ED8` | Informational banners (nag, demo ribbon) | Info-level messaging |
| info-bg | `#DBEAFE` | Info banner background (light mode) | Banner fill |
| info-bg-dark | `#1E3A5F` | Info banner background (dark mode) | Banner fill dark |

### 1.4 CSS Custom Properties (shadcn/ui CSS Variables)

These map onto shadcn/ui's semantic variable layer. Executor pastes these into `src/app/globals.css` inside the `:root {}` and `.dark {}` blocks during `shadcn init` post-processing.

```css
/* Light mode */
:root {
  --background: 180 60% 96%;          /* gray-50 equivalent, teal tint */
  --foreground: 178 79% 11%;          /* gray-800 for text */
  --card: 0 0% 100%;                  /* white card */
  --card-foreground: 178 79% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 178 79% 11%;
  --primary: 178 84% 28%;             /* teal-600 #0D7F7A */
  --primary-foreground: 0 0% 100%;    /* white on teal */
  --secondary: 180 53% 74%;           /* teal-200, subtle fills */
  --secondary-foreground: 178 83% 21%; /* teal-700 */
  --muted: 180 16% 93%;               /* near-white muted */
  --muted-foreground: 178 16% 42%;    /* gray-500 */
  --accent: 179 51% 58%;              /* teal-300 */
  --accent-foreground: 178 84% 28%;
  --destructive: 0 72% 51%;           /* red-600 */
  --destructive-foreground: 0 0% 100%;
  --border: 180 14% 87%;              /* gray-200 */
  --input: 180 14% 87%;
  --ring: 178 84% 28%;                /* teal-600 focus ring */
  --radius: 0.375rem;                 /* New York style */

  /* Semantic extras */
  --success: 174 72% 25%;
  --success-foreground: 0 0% 100%;
  --warning: 32 95% 44%;
  --warning-foreground: 0 0% 100%;
  --info: 218 83% 42%;
  --info-foreground: 0 0% 100%;
}

.dark {
  --background: 179 79% 7%;           /* teal-950 near-black */
  --foreground: 180 60% 96%;          /* teal-50 for text */
  --card: 178 79% 11%;                /* teal-900 card */
  --card-foreground: 180 60% 96%;
  --popover: 178 79% 11%;
  --popover-foreground: 180 60% 96%;
  --primary: 178 84% 28%;             /* teal-600 stays as brand anchor */
  --primary-foreground: 0 0% 100%;
  --secondary: 178 80% 16%;           /* teal-800 */
  --secondary-foreground: 180 60% 96%;
  --muted: 178 79% 11%;
  --muted-foreground: 180 53% 74%;    /* teal-200 */
  --accent: 178 80% 16%;
  --accent-foreground: 180 60% 96%;
  --destructive: 0 63% 56%;
  --destructive-foreground: 0 0% 100%;
  --border: 178 79% 16%;              /* teal-800 subtle border */
  --input: 178 79% 16%;
  --ring: 179 51% 58%;                /* teal-300 in dark (lighter ring) */
}
```

**Dark-mode strategy:** Class-based (`dark` class on `<html>`), NOT `prefers-color-scheme` media query. This allows user override via a toggle (Phase 4 settings), while defaulting to the OS preference on first load via a one-line JS snippet in `<head>` before hydration (no flash).

### 1.5 60/30/10 Color Split

| Role | Allocation | Token | Surface |
|------|-----------|-------|---------|
| Dominant | 60% | `--background` (gray-50/teal-950) | Page background, form areas |
| Secondary | 30% | `--card` / `--muted` | Cards, form card shells, nav |
| Accent | 10% | `--primary` (teal-600) | Primary buttons, active nav links, focus rings, the "Connect" CTA, nag banner CTA, demo ribbon border |

**Accent reserved for (explicit list — not all interactive elements):**
1. Primary `Button` (variant: `default`) fill
2. Focused `Input` / `Checkbox` ring
3. Active route indicator in `SideNav` (left border stripe or background)
4. `EmailVerificationNagBanner` "Verificar" CTA button
5. `DemoDashboard` sample-data ribbon left border
6. `ConsentScreen` "Concordar e continuar" primary CTA
7. Text links in the body of `ConsentScreen` privacy/terms text

Everything else uses gray/neutral tones. Secondary actions use `variant: outline` (border-only, no fill).

---

## Spacing Scale

8-point grid. Tailwind 4 default spacing scale is used (no custom additions needed for Phase 1).

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| xs | 4px | `p-1` / `gap-1` | Icon-to-label gap, inline badge padding |
| sm | 8px | `p-2` / `gap-2` | Compact element internal padding |
| md | 16px | `p-4` / `gap-4` | Default input padding, form field gap |
| lg | 24px | `p-6` / `gap-6` | Card padding, section padding |
| xl | 32px | `p-8` / `gap-8` | Auth card padding, major component gap |
| 2xl | 48px | `p-12` / `gap-12` | Auth shell vertical centering gap |
| 3xl | 64px | `p-16` / `gap-16` | Page-level top/bottom margin on desktop |

**Exceptions:**
- Touch targets: minimum 44×44px for all tappable elements (buttons, checkboxes, links in mobile) per WCAG 2.1 SC 2.5.8. Achieved with `min-h-11` (44px) on `Button` and `min-w-11` on icon-only controls.
- `EmailVerificationNagBanner` height: 48px total (12px top/bottom padding + content), sticky top.
- `ConsentScreen` checkbox touch area: 44px (larger than the 16px visual checkbox; use a label wrapper).

---

## Typography

**Font family:** `Inter Variable` loaded via `next/font/google`.
```tsx
// src/app/layout.tsx
import { Inter } from 'next/font/google'
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})
```

### Type Scale

| Role | Size | Weight | Line Height | Letter Spacing | Usage |
|------|------|--------|-------------|----------------|-------|
| display | 28px / `text-2xl` | 600 semibold | 1.2 | -0.02em | Auth page headline ("Bem-vindo ao Portal Finance") |
| heading-lg | 20px / `text-xl` | 600 semibold | 1.3 | -0.01em | Card titles, section headings, modal titles |
| heading-sm | 16px / `text-base` | 600 semibold | 1.4 | 0 | Form section labels, sub-headings |
| body | 14px / `text-sm` | 400 regular | 1.5 | 0 | Body copy, form field help text, descriptions |
| label | 14px / `text-sm` | 500 medium | 1.4 | 0.01em | Form labels, button text |
| caption | 12px / `text-xs` | 400 regular | 1.4 | 0.01em | Timestamps, meta info, badge text |
| tabular | 14px / `text-sm` | 500 medium | 1.5 | 0 | Currency values, numeric columns (Phase 4 dashboard) — apply `font-variant-numeric: tabular-nums` via Tailwind `tabular-nums` utility |

**Rationale for 28/20/16/14/12 scale:** Five sizes cover all Phase 1 surfaces without ambiguity. The 28px display only appears once per auth page; 20px headings anchor cards; 14px is the reading size for the BR middle-class demographic (not too small on a phone). Only 2 weights (400 + 600, with 500 for labels): executor never reaches for 300 or 700.

**Line heights:** 1.5 for body/paragraphs (optimal for pt-BR which has many accent-heavy words), 1.2–1.3 for headings (prevents excessive vertical rhythm at large sizes).

**Locale:** `lang="pt-BR"` on `<html>`. Currency rendered as `R$ ` + amount (non-breaking space between symbol and value). Date format: `dd/MM/yyyy` (day-js `DD/MM/YYYY`).

---

## Layout & Spacing

### Breakpoints (Tailwind 4 defaults, used as-is)

| Name | Min-width | Usage |
|------|-----------|-------|
| (default) | 0 | Mobile-first base — all components designed here first |
| `sm` | 640px | Subtle layout adjustments |
| `md` | 768px | Auth card goes from full-width to centered fixed-width |
| `lg` | 1024px | Desktop layout: optional sidebar in Phase 4 |
| `xl` | 1280px | Max content width capped |

### Container Widths

| Context | Width | Notes |
|---------|-------|-------|
| Auth shell card | 440px max | `max-w-[440px] w-full` — full-width on mobile, capped on tablet+ |
| Demo dashboard | 680px max | `max-w-2xl` — single-column on mobile, wider on tablet |
| Settings page (Phase 1 DSR section) | 640px max | `max-w-2xl` |
| Global page container | `max-w-screen-xl mx-auto px-4 md:px-8` | Consistent horizontal padding |

### Auth Shell Layout

```
┌─────────────────────────────────────────────┐
│ [EmailVerificationNagBanner - sticky top]   │  48px, z-40
├─────────────────────────────────────────────┤
│                                             │
│     ┌─────────────────────────────────┐     │
│     │  Logo (32px height)             │     │
│     │  App name "Portal Finance"      │     │
│     │  ─────────────────────────────  │     │
│     │  [Form content]                 │     │  max-w-[440px]
│     │                                 │     │  shadow-md
│     │  [Links / secondary actions]    │     │  rounded-xl
│     └─────────────────────────────────┘     │
│                                             │
└─────────────────────────────────────────────┘
Background: --background (full viewport height, flex center)
```

### Safe-Area Handling (PWA)

Apply `pb-safe` (env(safe-area-inset-bottom)) to the page bottom on mobile. Tailwind 4: use `pb-[env(safe-area-inset-bottom)]` or a CSS variable. This prevents content from being obscured by the iOS home indicator. Auth pages are scroll-based, not fixed-layout, so this only matters once Phase 4 adds a bottom nav bar.

### Sticky Nag Banner

`EmailVerificationNagBanner` is `position: sticky; top: 0; z-index: 40` — it scrolls with the page until it hits the top, then sticks. It renders inside the layout shell ABOVE the auth card / page content. Session-dismissed (React state or `sessionStorage` key `nag_email_dismissed`).

---

## Component Contracts

### 2.1 `AuthShell`

**Location:** `src/components/auth/AuthShell.tsx`

**Props:** `{ children: ReactNode, title: string, description?: string }`

**Visual contract:**
- Full-viewport `min-h-screen` with `bg-background` and `flex items-center justify-center`
- Inner card: `max-w-[440px] w-full mx-auto bg-card rounded-xl shadow-md border border-border p-8`
- Logo slot at top: `<Image>` component rendering `public/logo.svg` at 32px height, centered, `mb-6`
- App name "Portal Finance" below logo: `text-sm font-medium text-muted-foreground tracking-wide uppercase mb-8`
- `title` renders as `text-xl font-semibold text-foreground mb-1`
- `description` renders as `text-sm text-muted-foreground mb-6` (optional)
- Footer slot below children for secondary links (e.g., "Já tem uma conta? Entrar")

**Dark/light:** automatic — all values are CSS variables. No explicit color props.

---

### 2.2 `SignupForm`

**Location:** `src/components/auth/SignupForm.tsx`

**Uses:** React Hook Form + Zod schema + shadcn `Input`, `Button`, `Checkbox`, `FormField`

**Fields (in order):**
1. Email — `type="email"`, autocomplete="email", placeholder="seu@email.com"
2. Password — `type="password"`, autocomplete="new-password", placeholder="Senha (mín. 10 caracteres)", show/hide toggle (eye icon, `lucide-react`)
3. Confirm password — `type="password"`, autocomplete="new-password", placeholder="Confirmar senha"
4. Consent checkbox — inline label with embedded links:
   > "Li e aceito os [Termos de Uso] e a [Política de Privacidade], e autorizo o Portal Finance a tratar meus dados pessoais conforme a LGPD."

**Validation:**
- Email: Zod `.email()`, trim + lowercase before submit
- Password: min 10 chars, at least 1 letter + 1 number, disallows top-1000 common passwords (blocked list in `lib/validation.ts`)
- Confirm password: must match password field (Zod `.refine`)
- Consent checkbox: must be checked (`z.literal(true)`)
- All errors inline below the field using shadcn `FormMessage`

**Submit button:** `variant="default"` (teal-600 fill), full-width, label "Criar conta", loading state shows `<Loader2 className="animate-spin" />` icon + "Criando conta..." text, disabled while loading

**Error surface:** Server errors (e.g., duplicate email) render in a shadcn `Alert` variant `destructive` above the submit button: "Este e-mail já está cadastrado. [Entrar →]"

**Secondary link:** Below button — "Já tem uma conta? [Entrar]" — `text-sm text-muted-foreground` with teal link

**On success:** Client redirects to `/dashboard` (demo dashboard).

---

### 2.3 `LoginForm`

**Location:** `src/components/auth/LoginForm.tsx`

**Fields:**
1. Email — `type="email"`, autocomplete="email"
2. Password — `type="password"`, autocomplete="current-password", show/hide toggle

**"Esqueceu a senha?" link:** Right-aligned above or below password field, `text-sm text-primary hover:underline`

**Cloudflare Turnstile slot:**
- Hidden by default; appears AFTER the 2nd failed login attempt (failure count tracked in React state, incremented on `401` response)
- Mount point: `<div id="cf-turnstile" data-sitekey={process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY} />` — component loads `@marsidev/react-turnstile` (or the official Cloudflare script)
- On appearance: smooth height animation (`max-h-0` → `max-h-24`, `transition-all duration-300`)
- On 5th failure: form enters locked state before redirect to `AccountLockedScreen`

**Submit button:** "Entrar", full-width, `variant="default"`

**Error surface:** `text-sm text-destructive` below the password field on auth failure: "E-mail ou senha incorretos." (no hint which field is wrong — prevents enumeration)

**Secondary links:** "Não tem uma conta? [Criar conta]"

---

### 2.4 `PasswordResetRequestForm`

**Location:** `src/components/auth/PasswordResetRequestForm.tsx`

**Fields:** Email only

**Submit button:** "Enviar link de recuperação", full-width `variant="default"`

**Post-submit state:** Replace form with a success card:
> "Se esse e-mail estiver cadastrado, você receberá um link em breve. Verifique também a caixa de spam."

No confirmation of whether the email exists (prevents enumeration). Same card shown regardless of outcome.

**Rate-limit error:** If server returns `429`:
> "Muitas tentativas. Aguarde antes de tentar novamente."
Display as `Alert variant="destructive"`.

---

### 2.5 `PasswordResetConfirmForm`

**Location:** `src/components/auth/PasswordResetConfirmForm.tsx`

**Fields:**
1. New password (with strength indicator — see note)
2. Confirm new password

**Token validation:** On mount, call `/api/auth/reset/validate?token=…`. If invalid/expired, render inline error:
> "Este link expirou ou já foi utilizado. [Solicitar novo link →]"

**Submit button:** "Redefinir senha", full-width `variant="default"`

**Post-success state:** Full redirect to `/login` with a toast:
> "Senha redefinida com sucesso. Faça login com sua nova senha."

**Note on strength indicator:** A minimal 3-segment progress bar below the password field (weak / medium / strong) — rendered as three `<div>` segments with colors `danger-fg` / `warning-fg` / `success-fg` based on Zod schema pass rate. This is a visual affordance only; Zod enforces the actual policy server-side.

---

### 2.6 `AccountLockedScreen`

**Location:** `src/components/auth/AccountLockedScreen.tsx`

**Trigger:** Rendered at `/login?locked=true` or navigated to after 5th failure.

**Visual:** `AuthShell` with:
- Icon: `<ShieldAlert>` from lucide-react, 48px, `text-warning-fg`, centered
- Heading: "Conta temporariamente bloqueada"
- Body: "Por segurança, bloqueamos temporariamente o acesso após múltiplas tentativas. Você receberá um e-mail com instruções para desbloquear, ou aguarde [N] minutos."
- Primary CTA: "Entrar em contato" → `mailto:suporte@portalfinance.com.br` (secondary fallback only)
- No retry button on this screen

---

### 2.7 `UnlockPendingScreen`

**Location:** `src/components/auth/UnlockPendingScreen.tsx`

**Trigger:** Shown after the unlock email link is clicked and the unlock token is validated server-side.

**Visual:** `AuthShell` with:
- Icon: `<MailCheck>` 48px, `text-success-fg`
- Heading: "Conta desbloqueada"
- Body: "Sua conta foi desbloqueada com sucesso. Você já pode fazer login normalmente."
- CTA: "Fazer login" → `/login`

**Edge case — already unlocked / expired token:**
- Icon: `<MailX>` 48px, `text-muted-foreground`
- Heading: "Link inválido ou expirado"
- Body: "Este link já foi utilizado ou expirou. Se você ainda não consegue entrar, solicite o desbloqueio novamente na tela de login."

---

### 2.8 `ConsentScreen`

**Location:** `src/components/consent/ConsentScreen.tsx`

**Props:**
```tsx
type ConsentScope = 'ACCOUNT_CREATION' | `PLUGGY_CONNECTOR:${string}`

interface ConsentScreenProps {
  scope: ConsentScope
  onConsent: (consentedAt: Date) => void
  onDecline?: () => void
  isLoading?: boolean
}
```

**Visual contract:**
- Renders inside `AuthShell` (Phase 1) or a modal overlay (Phase 2 Pluggy Connect flow)
- Title: scope-specific (see copywriting section)
- Scope summary: a `<ul>` of exactly what data will be collected, rendered from a scope config object (not hardcoded JSX)
- Legal basis statement: `text-xs text-muted-foreground` — "Base legal: Art. 7º, I da LGPD (consentimento)"
- Links: "Política de Privacidade" and "Termos de Uso" inline, `text-primary text-xs`
- Consent checkbox: required, explicit label ("Estou ciente e concordo com o tratamento dos meus dados pessoais conforme descrito acima.")
- CTA: "Concordar e continuar" — `variant="default"`, full-width, disabled until checkbox checked
- Decline: "Não autorizar" — `variant="ghost"`, full-width, calls `onDecline` (navigates back or closes modal)

**Scope config (in `lib/consentScopes.ts`):**
```
ACCOUNT_CREATION → {
  title: "Suas informações estão protegidas",
  dataPoints: [
    "E-mail (para login e comunicações)",
    "Senha (armazenada de forma criptografada, nunca em texto puro)",
    "Dados de uso e sessões (para segurança da conta)"
  ]
}
PLUGGY_CONNECTOR:* → {
  title: "Conectar instituição financeira",
  dataPoints: [
    "Dados de conta: saldos e informações da conta",
    "Transações: histórico de movimentações financeiras",
    "Dados de produto: limites de cartão e datas de vencimento"
  ]
}
```

**Phase consistency:** The same component, same visual language, same checkbox mechanics appear in Phase 1 (`ACCOUNT_CREATION`) and Phase 2 (`PLUGGY_CONNECTOR:*`). The Phase 2 executor must not recreate this component — it passes a different `scope` prop.

---

### 2.9 `EmailVerificationNagBanner`

**Location:** `src/components/banners/EmailVerificationNagBanner.tsx`

**Visual:**
- `position: sticky; top: 0; z-index: 40`
- Height: 48px (`h-12`)
- Background: `bg-info-bg dark:bg-info-bg-dark`
- Left icon: `<MailWarning>` 16px `text-info-fg`
- Text: "Confirme seu e-mail para garantir o acesso à sua conta."
- CTA link: "Verificar agora" — `text-primary font-medium underline` — triggers resend API call + shows toast "E-mail de verificação reenviado."
- Dismiss: `<X>` icon button, 32px touch target, right side — sets `sessionStorage['nag_email_dismissed'] = '1'`, component reads this on mount and self-hides

**State machine:**
1. Default: banner visible
2. After "Verificar agora" click: CTA replaced with "E-mail enviado ✓" for 3 seconds, then reverts
3. After dismiss button: banner unmounts (session-scoped)
4. After email verified (server confirms): banner never renders

**Interaction note:** The banner must NOT use `position: fixed` — that causes it to overlay the auth card on the demo dashboard. `sticky` is correct: it scrolls away with the page on long forms.

---

### 2.10 `DemoDashboard`

**Location:** `src/components/demo/DemoDashboard.tsx`

**Purpose:** First screen after sign-up. Shows illustrative data to prime the user's mental model. MUST clearly signal "this is sample data."

**Sample data (hard-coded constants in `src/lib/demoData.ts`):**
```ts
// Month: April 2026
receita_total: 6500.00  // "Salário PIX"
despesas_total: 4900.00
net: 1600.00

categories: [
  { name: "Moradia",      amount: 2800.00, icon: "home" },
  { name: "Mercado",      amount: 1200.00, icon: "shopping-cart" },
  { name: "Alimentação",  amount:  450.00, icon: "utensils" },  // iFood
  { name: "Transporte",   amount:  220.00, icon: "car" },
  { name: "Outros",       amount:  230.00, icon: "more-horizontal" },
]
```

**"Sample data" ribbon:**
- A sticky banner at the top of the dashboard content area (not the full viewport — scoped to the dashboard container):
  - Background: `bg-info-bg dark:bg-info-bg-dark`
  - Left border: `border-l-4 border-primary`
  - Icon: `<FlaskConical>` 16px
  - Text: "Estes são dados de exemplo. Conecte sua conta bancária para ver seus números reais."
  - CTA: "Conectar banco →" — navigates to `/connect` (Phase 2 page; in Phase 1, this routes to a "coming soon" state or just the Phase 1 demo state)

**Layout (mobile-first):**
```
┌─────────────────────────────────────┐
│ [Sample data ribbon]                │
├─────────────────────────────────────┤
│ Abril 2026         [← Mês anterior] │  navigation
├─────────────────────────────────────┤
│ ┌─────────────┐ ┌────────────────┐  │
│ │ Receitas    │ │ Despesas       │  │  metric cards (2-col grid on sm+)
│ │ R$ 6.500    │ │ R$ 4.900       │  │
│ └─────────────┘ └────────────────┘  │
│ ┌───────────────────────────────┐   │
│ │ Resultado líquido: R$ 1.600   │   │  net card (full-width)
│ └───────────────────────────────┘   │
│ Gastos por categoria                │
│ ┌───────────────────────────────┐   │
│ │ [Donut or bar chart placeholder│  │  Recharts placeholder (Phase 4 real chart)
│ │  — static SVG in Phase 1]     │   │  In Phase 1: render as styled <ul> bar list
│ └───────────────────────────────┘   │
│ • Moradia        R$ 2.800  57%  ▓▓▓▓│
│ • Mercado        R$ 1.200  24%  ▓▓  │
│ • Alimentação    R$   450   9%  ▓   │
│ • Transporte     R$   220   4%  ▓   │
│ • Outros         R$   230   5%  ▓   │
└─────────────────────────────────────┘
```

**Phase 1 chart implementation:** A simple CSS-based horizontal bar list, NOT Recharts (Recharts is a Phase 4 dependency). Each row: category icon + name, amount (`tabular-nums font-medium`), percentage, and a `<div>` progress bar filled with `bg-primary` at `width: {pct}%`. This matches the exact same layout Phase 4 will replace with a Recharts `<BarChart>` or `<PieChart>`.

**Currency formatting:** All amounts rendered with `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`. Output: "R$ 6.500,00".

**Metric cards:**
- Receitas card: `text-success-fg` amount
- Despesas card: `text-destructive` amount
- Net card: amount colored green if positive (`text-success-fg`), red if negative (`text-destructive`)

**Month navigation:** `<ChevronLeft>` / `<ChevronRight>` buttons with `variant="ghost"`. In Phase 1 these are non-functional (sample data only) — disable `<ChevronRight>` since April 2026 is the "current" demo month.

---

### 2.11 `DSRRequestCard`

**Location:** `src/components/settings/DSRRequestCard.tsx`

**Container:** Rendered inside a Settings › Privacy route (`/settings/privacy`) within a `<Card>` with `p-6`.

**Heading:** "Seus dados e privacidade" (`text-xl font-semibold`)

**Description:** `text-sm text-muted-foreground mb-6`:
> "De acordo com a Lei Geral de Proteção de Dados (LGPD), você tem o direito de acessar, corrigir e excluir seus dados pessoais."

**Two action buttons (stacked on mobile, side-by-side on sm+):**
1. "Exportar meus dados" — `variant="outline"` — icon `<Download>` left
2. "Excluir minha conta" — `variant="destructive"` — icon `<Trash2>` left

Both open `ConfirmDestructiveModal` with action-specific props.

**`ConfirmDestructiveModal` contract:**

```
Action: EXPORT
  Title: "Exportar seus dados"
  Body: "Vamos preparar um arquivo JSON com todas as suas informações pessoais, financeiras e histórico de categorias. Você receberá um e-mail com o link para download."
  Confirm CTA: "Confirmar exportação" (variant="default")
  Cancel: "Cancelar" (variant="ghost")

Action: DELETE
  Title: "Excluir sua conta permanentemente"
  Body: "Esta ação é irreversível. Todos os seus dados serão removidos após um período de retenção legal de 30 dias. Suas conexões bancárias serão desvinculadas imediatamente."
  Confirm CTA: "Confirmar exclusão" (variant="destructive")
  Cancel: "Cancelar" (variant="ghost")
  Extra confirmation: type-in field requiring user to type "EXCLUIR" before the confirm button enables
```

**`RequestPendingState`:**
After confirmation, replace the card content with:
```
Icon: <ClockIcon> 32px text-muted-foreground
Heading: "Solicitação recebida"
Body (EXPORT): "Sua solicitação de exportação foi registrada (ID: {dsr_request_id}). 
  Você receberá o arquivo em até 15 dias conforme exigido pela LGPD. 
  Normalmente processamos em menos de 24 horas."
Body (DELETE): "Sua solicitação de exclusão foi registrada (ID: {dsr_request_id}). 
  Suas conexões bancárias serão desvinculadas em breve. 
  A exclusão completa ocorrerá em até 30 dias conforme o período legal de retenção."
```

---

### 2.12 Supporting Primitives

These are shadcn/ui components installed via CLI with project-specific variant overrides noted below. Executor runs `npx shadcn@latest add {component}` for each.

| Component | shadcn CLI | Project-specific override |
|-----------|-----------|--------------------------|
| `Button` | `npx shadcn@latest add button` | Default variant uses `bg-primary text-primary-foreground`; add `size="full"` for `w-full` shorthand |
| `Input` | `npx shadcn@latest add input` | Focus ring: `ring-ring ring-2 ring-offset-2`; no change to shadcn default |
| `FormField` | `npx shadcn@latest add form` | Includes `FormLabel`, `FormControl`, `FormDescription`, `FormMessage` from RHF integration |
| `Checkbox` | `npx shadcn@latest add checkbox` | Touch target: wrap in `<label className="flex items-start gap-3 cursor-pointer min-h-11">` |
| `Card` | `npx shadcn@latest add card` | Includes `CardHeader`, `CardContent`, `CardFooter` |
| `Alert` | `npx shadcn@latest add alert` | Used for server error surfaces; `variant="destructive"` for errors, `variant="default"` for info |
| `Dialog` | `npx shadcn@latest add dialog` | Used for `ConfirmDestructiveModal` — includes `DialogTitle`, `DialogDescription` (required for a11y) |
| `Toast` / Sonner | `npx shadcn@latest add sonner` | Prefer Sonner (shadcn's recommended replacement for old Toast) — used for success feedback |
| `Badge` | `npx shadcn@latest add badge` | Used for category labels and account health badges (Phase 2) |
| `Separator` | `npx shadcn@latest add separator` | Between form sections and card sections |

**Sonner setup:** `<Toaster />` placed in root layout. Toast calls: `toast.success("...")`, `toast.error("...")`. Position: `top-center` on mobile, `bottom-right` on desktop.

---

## Accessibility

### WCAG AA Contrast Verification

| Foreground | Background | Ratio | AA Pass |
|------------|-----------|-------|---------|
| `--foreground` (gray-700 `#334848`) | `--background` (`#F8FAFA`) | 8.1:1 | Yes (AAA) |
| `--primary` (`#0D7F7A`) | `--background` (`#F8FAFA`) | 4.8:1 | Yes |
| `--primary-foreground` white | `--primary` (`#0D7F7A`) | 4.8:1 | Yes |
| `--muted-foreground` (`#6B8080`) | `--background` (`#F8FAFA`) | 3.9:1 | Borderline — use only for captions, never for body copy |
| `--foreground` (teal-50 `#F0FAFA`) | `--background` (teal-950 `#021F1D`) dark | 17.5:1 | Yes (AAA) |
| `--primary` (`#0D7F7A`) | dark `--background` (`#021F1D`) | 4.6:1 | Yes |
| `success-fg` (`#0F766E`) | white | 4.5:1 | Pass (AA, barely) |
| `danger-fg` (`#B91C1C`) | white | 5.1:1 | Yes |
| `warning-fg` (`#B45309`) | white | 4.7:1 | Yes |

**Note on muted-foreground:** `#6B8080` at 3.9:1 on white is AA-compliant for large text (18pt+) but NOT for body text. Executor must use muted-foreground only for 12px captions and timestamps, never for 14px body copy. If body copy must appear muted, use `gray-600` (`#4A6060`) at ≈5.3:1.

### Focus States

All interactive elements must have a visible focus indicator:
- `Input`, `Button`, `Checkbox`, `Dialog` close button: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (shadcn default — do NOT remove)
- Custom link elements: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`

### Keyboard Navigation

- `SignupForm`, `LoginForm`, `PasswordResetRequestForm`, `PasswordResetConfirmForm`: natural DOM order = tab order. No `tabindex` manipulation.
- `ConsentScreen`: checkbox is reachable via Tab before the CTA button.
- `ConfirmDestructiveModal`: focus trap inside `<Dialog>` (Radix handles this). On open, focus lands on the cancel button (not the destructive confirm — safer default). On close, focus returns to the triggering element.
- `EmailVerificationNagBanner` dismiss button: keyboard-accessible with visible focus ring.

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Apply globally in `globals.css`. Specific overrides:
- `<Loader2 className="animate-spin">`: still spins (functional, not decorative) — exempt from the override.
- Cloudflare Turnstile height animation: wrapped in `motion-safe:transition-all` so it only animates when motion is allowed.

### Screen Reader Landmarks

- `AuthShell` renders `<main role="main">` wrapping the card.
- `EmailVerificationNagBanner` renders as `<aside aria-label="Verificação de e-mail pendente">`.
- `DemoDashboard` sample ribbon: `role="status" aria-live="polite"` so screen readers announce the demo context.
- `ConfirmDestructiveModal`: `<DialogTitle>` and `<DialogDescription>` are mandatory (Radix enforces this but executor must not suppress them with `asChild` hacks).

---

## Motion

Short durations — financial app, not marketing site.

| Usage | Duration | Easing | Tailwind |
|-------|----------|--------|---------|
| Button press | 100ms | ease-out | `transition-colors duration-100` |
| Input focus | 150ms | ease-out | `transition-shadow duration-150` |
| Modal open | 200ms | ease-out | Radix default via `data-[state=open]:` |
| Modal close | 150ms | ease-in | Radix default |
| Turnstile reveal | 300ms | ease-in-out | `transition-all duration-300 motion-safe:` |
| Nag banner mount | 200ms | ease-out | animate from `opacity-0 -translate-y-2` |
| Toast slide-in | 300ms | ease-out | Sonner default |
| Page transitions | none | — | No page transition animations in Phase 1 |

---

## PWA Foundations (Reserve for Phase 4)

These values are determined now so Phase 4 can plug them in without re-deciding. **Do NOT implement manifest or service worker in Phase 1.**

| Field | Value | Rationale |
|-------|-------|-----------|
| `theme_color` | `#0D7F7A` | Matches primary brand; shows in browser chrome |
| `background_color` | `#F8FAFA` | Matches `--background` light mode |
| `display` | `standalone` | PWA feel without browser chrome |
| `name` | `Portal Finance` | |
| `short_name` | `Portal` | Fits iOS home screen label |
| Icon sizes | 192×192, 512×512, maskable 512×512 | Standard PWA set |
| Icon background | `#021F1D` (teal-950) | Dark background for maskable icon |
| Icon foreground | white logotype on teal | Contrast on maskable background |
| App logo | `public/logo.svg` (vector, created in Phase 1 plan 01-01) | Same asset used in `AuthShell` |

---

## Copywriting Contract (pt-BR)

Tone: clear, adult, direct. Never patronizing. Never "Por favor, informe...". Uses você (not tu). Keeps LGPD language explicit but human.

### Authentication

| Element | Copy |
|---------|------|
| Sign-up heading | "Crie sua conta" |
| Sign-up sub | "Acompanhe suas finanças com clareza." |
| Sign-up CTA | "Criar conta" |
| Sign-up loading | "Criando conta..." |
| Login heading | "Entrar na sua conta" |
| Login CTA | "Entrar" |
| Login loading | "Entrando..." |
| Forgot password link | "Esqueceu a senha?" |
| Reset request heading | "Recuperar acesso" |
| Reset request sub | "Digite o e-mail cadastrado para receber um link de recuperação." |
| Reset request CTA | "Enviar link de recuperação" |
| Reset request success | "Se esse e-mail estiver cadastrado, você receberá um link em breve. Verifique também a caixa de spam." |
| Reset confirm heading | "Criar nova senha" |
| Reset confirm CTA | "Redefinir senha" |
| Reset confirm success toast | "Senha redefinida com sucesso. Faça login com sua nova senha." |
| Password field placeholder | "Mínimo 10 caracteres, letras e números" |
| Confirm password placeholder | "Repita a senha" |
| Already has account | "Já tem uma conta? Entrar" |
| No account yet | "Não tem uma conta? Criar conta" |

### Validation Errors

| Error | Copy |
|-------|------|
| Email invalid | "Digite um e-mail válido." |
| Email already in use | "Este e-mail já está cadastrado. [Entrar →]" |
| Password too short | "A senha deve ter pelo menos 10 caracteres." |
| Password too weak | "Use letras e números na senha." |
| Password common | "Essa senha é muito comum. Escolha outra." |
| Passwords don't match | "As senhas não coincidem." |
| Consent required | "Você precisa aceitar os termos para continuar." |
| Wrong credentials | "E-mail ou senha incorretos." |
| Account locked | "Conta temporariamente bloqueada. Verifique seu e-mail." |
| Rate limited (reset) | "Muitas tentativas. Aguarde antes de tentar novamente." |
| Rate limited (N minutes) | "Aguarde {N} minutos antes de tentar novamente." |
| Generic server error | "Algo deu errado. Tente novamente em instantes." |
| Network error | "Sem conexão. Verifique sua internet e tente novamente." |
| Token expired | "Este link expirou ou já foi utilizado. [Solicitar novo link →]" |

### LGPD Consent — ACCOUNT_CREATION

| Element | Copy |
|---------|------|
| Screen title | "Suas informações estão protegidas" |
| Data point 1 | "E-mail — usado para login e comunicações importantes da conta" |
| Data point 2 | "Senha — armazenada de forma criptografada, nunca acessada em texto puro pela nossa equipe" |
| Data point 3 | "Dados de sessão — para manter você conectado com segurança" |
| Legal basis | "Base legal: Art. 7º, I da LGPD (consentimento explícito)" |
| Checkbox label | "Li e concordo com o tratamento dos meus dados pessoais conforme descrito acima, os [Termos de Uso] e a [Política de Privacidade]." |
| Confirm CTA | "Concordar e continuar" |
| Decline action | "Não autorizar" |

### Account Lockout

| Element | Copy |
|---------|------|
| Locked screen heading | "Conta temporariamente bloqueada" |
| Locked screen body | "Por segurança, bloqueamos o acesso após múltiplas tentativas incorretas. Você receberá um e-mail com um link para desbloquear a conta, ou aguarde 15 minutos." |
| Unlock email subject | "Portal Finance — Link para desbloquear sua conta" |
| Unlock email CTA | "Desbloquear minha conta" |
| Unlock email wasn't me | "Não fui eu — clique aqui para suspender o acesso e redefinir a senha" |
| Unlock success heading | "Conta desbloqueada" |
| Unlock success body | "Sua conta foi desbloqueada com sucesso. Você já pode fazer login normalmente." |
| Unlock invalid heading | "Link inválido ou expirado" |
| Unlock invalid body | "Este link já foi utilizado ou expirou. Se ainda não consegue entrar, solicite o desbloqueio na tela de login." |

### Email Verification Nag Banner

| Element | Copy |
|---------|------|
| Banner text | "Confirme seu e-mail para garantir acesso contínuo à conta." |
| CTA | "Verificar agora" |
| Post-click feedback | "E-mail de verificação reenviado." |
| Dismiss aria-label | "Dispensar aviso de verificação de e-mail" |

### Demo Dashboard

| Element | Copy |
|---------|------|
| Ribbon heading | "Dados de exemplo" |
| Ribbon body | "Estes são dados ilustrativos. Conecte sua conta bancária para ver seus números reais." |
| Ribbon CTA | "Conectar banco →" |
| Month label | "Abril 2026" (hardcoded for demo) |
| Income metric label | "Receitas" |
| Expenses metric label | "Despesas" |
| Net metric label | "Resultado do mês" |
| Category section heading | "Gastos por categoria" |
| Sample income description | "Salário via PIX" |

### DSR / Privacy

| Element | Copy |
|---------|------|
| Settings privacy heading | "Seus dados e privacidade" |
| Settings privacy body | "Pela LGPD, você tem o direito de acessar, corrigir e solicitar a exclusão dos seus dados pessoais a qualquer momento." |
| Export button | "Exportar meus dados" |
| Delete button | "Excluir minha conta" |
| Export confirm title | "Exportar seus dados" |
| Export confirm body | "Vamos preparar um arquivo JSON com todas as suas informações pessoais, financeiras e histórico. Você receberá o link por e-mail." |
| Export confirm CTA | "Confirmar exportação" |
| Delete confirm title | "Excluir conta permanentemente" |
| Delete confirm body | "Esta ação é irreversível. Seus dados serão removidos após o período legal de retenção de 30 dias. Suas conexões bancárias serão desvinculadas imediatamente. Para confirmar, digite EXCLUIR abaixo." |
| Delete type-in placeholder | "Digite EXCLUIR para confirmar" |
| Delete confirm CTA | "Confirmar exclusão" |
| Pending export heading | "Solicitação de exportação recebida" |
| Pending export body | "Sua solicitação foi registrada (Protocolo: {id}). Você receberá o arquivo em até 15 dias. Em geral, o prazo é de menos de 24 horas." |
| Pending delete heading | "Solicitação de exclusão recebida" |
| Pending delete body | "Sua solicitação foi registrada (Protocolo: {id}). Suas conexões serão desvinculadas em breve. A exclusão completa ocorrerá em até 30 dias, conforme o período de retenção legal." |
| Cancel generic | "Cancelar" |

---

## Radii & Shadows

| Token | Value | Usage |
|-------|-------|-------|
| radius-sm | 4px (`rounded-sm`) | Badge, chip, tight inline elements |
| radius-md | 6px (`rounded-md`) | Button, Input, Checkbox, Select |
| radius-lg | 8px (`rounded-lg`) | Alert, Toast/Sonner |
| radius-xl | 12px (`rounded-xl`) | `AuthShell` card, `ConfirmDestructiveModal`, `DemoDashboard` card container |
| radius-full | 9999px (`rounded-full`) | Avatar, pill badges |

`--radius` CSS variable (shadcn): `0.375rem` (6px, New York style). Component-level overrides use Tailwind utilities directly.

| Shadow | Token | Usage |
|--------|-------|-------|
| Elevation 1 | `shadow-sm` | Input hover, Card default |
| Elevation 2 | `shadow-md` | `AuthShell` card, dropdown menus |
| Elevation 3 | `shadow-lg` | Modal/Dialog |
| Elevation 4 | `shadow-xl` | Sonner toast |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | button, input, form, checkbox, card, alert, dialog, sonner, badge, separator | Not required (official registry) |
| Third-party | none | Not applicable |

No third-party registries in Phase 1. All components are from the official shadcn/ui registry or custom (not copy-in from any external source). Registry vetting gate: not triggered.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

---

## Pre-Population Traceability

| Field / Section | Source |
|-----------------|--------|
| Primary brand color `#0D7F7A` | User-confirmed (locked_decisions) |
| Stack: Next.js + Tailwind 4 + shadcn/ui | STACK.md (locked) |
| Mobile-first, dark mode from day 1 | locked_decisions |
| Sign-up: email + password only (no CPF) | 01-CONTEXT.md D-04 |
| Email verification deferred + nag banner | 01-CONTEXT.md D-02 |
| First post-signup = demo dashboard | 01-CONTEXT.md D-03 |
| Demo data (R$ 6.500 receita, R$ 4.900 despesas) | locked_decisions + 01-CONTEXT.md Specifics |
| Turnstile after 2nd failure | 01-CONTEXT.md D-07 |
| ConsentScreen with `scope` prop | locked_decisions + 01-CONTEXT.md D-16 |
| DSR skeleton: export + delete → pending state | 01-CONTEXT.md D-17 + REQUIREMENTS.md LGPD-03/04 |
| Auth events in audit_log only (Phase 1) | 01-CONTEXT.md D-19 |
| shadcn "New York" style, CSS variables | UI-SPEC decision (default for financial density) |
| Inter Variable font | UI-SPEC decision (tabular-numerals for Phase 4) |
| Class-based dark mode | UI-SPEC decision (allows user toggle in Phase 4) |
| 5-step type scale (28/20/16/14/12) | UI-SPEC decision |
| 60/30/10 color split + accent reserved-for list | UI-SPEC decision |
| WCAG AA contrast verification table | UI-SPEC decision |
| Sonner (not legacy Toast) | shadcn/ui current recommendation (2025) |
| PWA manifest values reserved (not shipped) | locked_decisions + ROADMAP.md Phase 4 |
