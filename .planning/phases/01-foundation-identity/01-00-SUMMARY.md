---
phase: 01-foundation-identity
plan: 00
subsystem: web-foundation
tags: [nextjs-16, typescript-5.7, tailwind-4, shadcn, vitest, playwright, testcontainers, scaffold]
requires: []
provides:
  - "Next.js 16 + TS 5.7 + Tailwind 4 + shadcn/ui scaffold"
  - "Vitest + Playwright + testcontainers test harness"
  - "package.json scripts (test:unit, test:integration, test:e2e, test:all, build, start:web, start:worker, db:generate, db:migrate)"
  - "UI-SPEC § 1.4 teal CSS variables (light + dark)"
  - "Inter Variable font + lang=pt-BR root layout"
  - "Phase 1 shadcn primitives (button, input, label, form, checkbox, card, alert, dialog, sonner, badge, separator)"
  - "Test fixtures: testcontainers Postgres helper, SES mock, PII corpus"
affects: []
tech-stack:
  added:
    - "next@16.2.4"
    - "react@19.1.0 + react-dom@19.1.0"
    - "typescript@5.7.3"
    - "tailwindcss@4.0.14 + @tailwindcss/postcss@4.0.14"
    - "zod@4.3.6"
    - "lucide-react@0.468.0"
    - "vitest@3.0.5 + @vitest/coverage-v8 + @vitest/ui"
    - "@playwright/test@1.51.1 (bumped from plan-pinned 1.49.1 for Next 16 peer-dep)"
    - "testcontainers@10.16.0 + @testcontainers/postgresql@10.16.0"
    - "@testing-library/react@16.1.0 + @testing-library/jest-dom@6.6.3 + happy-dom@15.11.7"
    - "aws-sdk-client-mock@4.1.0 + @aws-sdk/client-ses@3.1034.0"
    - "msw@2.7.0"
    - "tsx@4.19.2 + tsup@8.3.5"
    - "@next/env@^16.2.4"
    - "shadcn (CLI, devDep) + 11 primitives + their Radix/RHF/sonner runtime deps"
  patterns:
    - "Tailwind 4 @theme inline maps shadcn HSL CSS variables onto utility surfaces"
    - "Vitest 3.0.5 dual-workspace projects (unit happy-dom / integration node-with-testcontainers)"
    - "Playwright webServer auto-spawns pnpm start:web on baseURL http://localhost:3000"
    - "tests/setup.ts injects safe defaults for ENCRYPTION_KEY / CPF_HASH_PEPPER / NEXTAUTH_SECRET"
key-files:
  created:
    - "package.json"
    - "pnpm-lock.yaml"
    - "tsconfig.json"
    - "next.config.ts"
    - "tailwind.config.ts"
    - "postcss.config.mjs"
    - ".nvmrc"
    - ".gitignore"
    - "next-env.d.ts"
    - "components.json"
    - "vitest.config.ts"
    - "playwright.config.ts"
    - "src/app/layout.tsx"
    - "src/app/page.tsx"
    - "src/app/globals.css"
    - "src/lib/utils.ts"
    - "src/components/ui/button.tsx"
    - "src/components/ui/input.tsx"
    - "src/components/ui/label.tsx"
    - "src/components/ui/form.tsx"
    - "src/components/ui/checkbox.tsx"
    - "src/components/ui/card.tsx"
    - "src/components/ui/alert.tsx"
    - "src/components/ui/dialog.tsx"
    - "src/components/ui/sonner.tsx"
    - "src/components/ui/badge.tsx"
    - "src/components/ui/separator.tsx"
    - "public/logo.svg"
    - "tests/setup.ts"
    - "tests/fixtures/db.ts"
    - "tests/fixtures/mailer.ts"
    - "tests/fixtures/pii-corpus.ts"
    - "tests/unit/_scaffold.test.ts"
    - "tests/integration/_scaffold.test.ts"
    - "tests/e2e/_scaffold.spec.ts"
  modified: []
decisions:
  - "Bump @playwright/test 1.49.1 → 1.51.1 to satisfy Next 16.2.4 peer dep (was a Rule 3 install-time blocker)."
  - "Override shadcn CLI v4 preset style 'radix-nova' → 'new-york' in components.json to match UI-SPEC."
  - "Use Tailwind 4's @theme inline mapping for shadcn HSL vars (introduced by shadcn init) instead of legacy hsl(var(--token)) usage in component files."
  - "next.config.ts pins turbopack.root to package dir to avoid stray $HOME lockfile workspace-root false-detection."
  - "Vitest 3.0.5 ships the workspace API; projects field arrived in 3.2+. vitest.config.ts uses workspace[] for unit + integration."
  - "start:web simplified to 'next start' — bash-style ${PORT:-3000} substitution is broken on Windows when Playwright spawns the script; Next honours $PORT natively."
metrics:
  duration_seconds: 684
  duration_minutes: 11.4
  tasks_completed: 3
  files_created: 35
  commits: 4
  completed: "2026-04-22T20:21:12Z"
---

# Phase 1 Plan 00: Wave 0 — Greenfield Scaffold Summary

Greenfield Next.js 16 + TS 5.7 + Tailwind 4 + shadcn/ui scaffold with the full Vitest / Playwright / testcontainers harness landed and verified end-to-end. Every Wave 1+ plan in Phase 1 can now `pnpm install` against a frozen lockfile, build with `pnpm build`, and run `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e` without further setup.

## Tasks Completed

| Task | Name                                                                              | Commit    |
| ---- | --------------------------------------------------------------------------------- | --------- |
| 1    | Initialize repo — package.json, Next.js 16, TS 5.7, Tailwind 4, pnpm              | `f592a17` |
| 2    | Initialise shadcn/ui (New York + CSS variables) and install Phase 1 primitives    | `0020ca6` |
| 3    | Vitest + Playwright + testcontainers configuration and Wave 0 test fixtures      | `00ecf99` |
| 3-fix | Cast process.env.NODE_ENV assignment for @types/node 22+ readonly union          | `7885dfc` |

## What Was Built

### Repository Skeleton
- `package.json` pins exact runtime versions per RESEARCH.md Stack Verification table (next 16.2.4, react 19.1.0, tailwindcss 4.0.14, zod 4.3.6, vitest 3.0.5, testcontainers 10.16.0).
- `tsconfig.json` strict mode + `moduleResolution: bundler` + `@/* → ./src/*` alias; jsx auto-set to `react-jsx` by Next 16 (mandatory).
- `next.config.ts` with promoted `typedRoutes`, `output: standalone`, and `turbopack.root` pinned to package dir (avoids stray `$HOME/package-lock.json` workspace-root false-detection).
- `.nvmrc` pinned to Node 20 LTS for argon2 prebuild compatibility (Pitfall 3 / RESEARCH.md A6).
- `.gitignore` covers Next.js, pnpm, test artifacts, env files, build caches.

### Design System Foundation
- `src/app/layout.tsx` loads Inter Variable via `next/font/google` and emits `<html lang="pt-BR">` (load-bearing per UI-SPEC § Typography locale).
- `src/app/globals.css` carries every UI-SPEC § 1.4 token in HSL channel-triplet form, both `:root` light and `.dark` blocks, plus chart and sidebar token sets used by Phase 4. Reduced-motion media query per UI-SPEC § Accessibility.
- shadcn/ui v4 initialised with `--preset nova --base radix --css-variables`; we patched `components.json` `style` to `"new-york"` to honour the UI-SPEC contract while keeping the v4 layout.
- 11 primitives installed in `src/components/ui/` lowercase per shadcn convention (button, input, label, form, checkbox, card, alert, dialog, sonner, badge, separator).
- `public/logo.svg` placeholder wordmark in teal-600 for AuthShell (Phase 4 PWA polish will replace).

### Test Harness
- `vitest.config.ts` defines two workspace projects sharing a single `tests/setup.ts` file:
  - `unit` — happy-dom env, picks up `tests/unit/**/*.test.{ts,tsx}`.
  - `integration` — node env, 60 s `testTimeout` / 120 s `hookTimeout` to absorb testcontainers image pull + Postgres boot.
- `playwright.config.ts` runs the chromium project with auto-spawned `pnpm start:web` web server, baseURL `http://localhost:3000`, retries 2 in CI, screenshots on failure.
- `tests/setup.ts` calls `loadEnvConfig` from `@next/env` and seeds safe-default secrets for `ENCRYPTION_KEY`, `CPF_HASH_PEPPER`, `NEXTAUTH_SECRET` so unit tests do not depend on `.env.local`.
- `tests/fixtures/db.ts` — testcontainers Postgres 16 helper with a clear "Is Docker running?" error message on Windows (Pitfall 9).
- `tests/fixtures/mailer.ts` — `aws-sdk-client-mock` SES mock that captures sent payloads in an array for assertion.
- `tests/fixtures/pii-corpus.ts` — fake-but-real-shaped CPF / email / phone / PIX-description / token corpus consumed by the piiScrubber tests landing in plan 01-03.
- Scaffold tests for all three layers all pass on first execution: `pnpm test:unit` (1.0 s), `pnpm test:e2e` (3.3 s), `pnpm test:integration` (19.0 s with full container pull / boot).

## Confirmation: shadcn init did NOT clobber UI-SPEC tokens

The shadcn CLI's `nova` preset wrote oklch-based neutral colour vars and added a Geist font into `layout.tsx`. Per the plan's risk note, both files were restored in the same commit:
- `src/app/globals.css` — replaced neutral oklch vars with the UI-SPEC § 1.4 teal HSL palette. `--primary: 178 84% 28%` and `--radius: 0.375rem` survive in the final commit (verified with `grep`).
- `src/app/layout.tsx` — dropped the auto-added Geist import; Inter remains the sole font (UI-SPEC § Typography contract).
- `components.json` — patched `style` from `"radix-nova"` (CLI v4 preset name) to `"new-york"`.

The useful structural patterns shadcn introduced were kept: `@custom-variant dark`, `@theme inline` colour mapping, Radix-UI dependency baseline. Sidebar and chart token sets were retained but rewritten in the teal palette so Phase 4 inherits a consistent token system.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking peer dep] Bumped @playwright/test 1.49.1 → 1.51.1**
- **Found during:** Task 1 `pnpm install`
- **Issue:** Next 16.2.4 declares `@playwright/test ^1.51.1` as a peer dependency; the plan-pinned 1.49.1 produced an unmet-peer warning and could surface at build time.
- **Fix:** Bumped pin to 1.51.1; reinstalled — peer warning gone.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Commit:** `f592a17`

**2. [Rule 3 — Blocking shadcn CLI flag] Used `--preset nova` instead of removed `--style`**
- **Found during:** Task 2 `npx shadcn init`
- **Issue:** shadcn CLI v4 dropped the `--style new-york` flag in favour of preset profiles (`nova`, `vega`, `maia`, etc.). The init command errored with `unknown option '--style'`.
- **Fix:** Used `--preset nova --base radix --css-variables`, then patched `components.json` `style` field to `"new-york"` to match UI-SPEC's contract.
- **Files modified:** `components.json`
- **Commit:** `0020ca6`

**3. [Rule 1 — Bug] start:web bash substitution broken on Windows**
- **Found during:** Task 3 `pnpm test:e2e` (Playwright webServer spawn)
- **Issue:** `next start -p ${PORT:-3000}` was passed verbatim to `next` because Playwright's webServer spawn does not run the script through a Bash shell on Windows. `next` then errored: `argument '${PORT:-3000}' is invalid`.
- **Fix:** Simplified to `next start`. Next.js already honours `$PORT` natively, so the substitution was redundant and broken.
- **Files modified:** `package.json`
- **Commit:** `00ecf99`

**4. [Rule 1 — Bug] @types/node 22 readonly NODE_ENV broke setup.ts**
- **Found during:** Final verification gate (`pnpm install --frozen-lockfile && pnpm typecheck`)
- **Issue:** `@types/node@22.10.5` typed `process.env.NODE_ENV` as a readonly string-literal union. `tests/setup.ts` line `process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'` triggered TS2540.
- **Fix:** Cast through `Record<string, string>` so the assignment satisfies the compiler without weakening the runtime contract. Vitest sets `NODE_ENV=test` before the setup file runs, so the assignment remains a defensive no-op.
- **Files modified:** `tests/setup.ts`
- **Commit:** `7885dfc`

### Architectural Notes (no Rule 4 stops triggered)

- shadcn CLI v4 added several runtime deps the plan did not enumerate (`react-hook-form`, `@hookform/resolvers`, `next-themes`, `sonner`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `radix-ui`, individual `@radix-ui/*` packages). All are peer dependencies of the installed primitives — not optional. Documented in the Tech Stack Added list above.
- The `shadcn` CLI itself was incorrectly added to `dependencies` by the init step; manually moved to `devDependencies` (it's a CLI, not a runtime lib).

### Deferred Items

- `pnpm start:web` emits a Next.js warning when `output: standalone` is configured: "use node .next/standalone/server.js instead". Fine for dev/test today; Phase 6 Railway deploy work should switch the production startup command.
- Engine warning `wanted: {"node":">=20.0.0 <21.0.0"} (current: v24.13.0)` is informational only — host has Node 24 instead of the pinned Node 20. Production / Railway will use Node 20 via `.nvmrc`. No action.

## Authentication Gates

None. Wave 0 ships no authenticated paths.

## Patterns Established for Wave 1

- **Folder layout:** `src/app/` (Next App Router), `src/components/ui/` (shadcn primitives, lowercase per CLI), `src/lib/` (helpers — `utils.ts` already created), `tests/{unit,integration,e2e}/` + `tests/fixtures/`.
- **Path alias:** `@/*` → `./src/*` works in both TS and Vitest configs.
- **Script names** are now load-bearing — Wave 1+ plans should call `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build`, `pnpm db:generate`, `pnpm db:migrate`.
- **Token system:** every colour comes from a shadcn HSL CSS variable mapped via `@theme inline`. New components reach for `bg-background`, `text-foreground`, `bg-primary`, `border-border` etc. — never hard-coded teal hex.
- **Test fixtures:** `tests/fixtures/db.ts` (testcontainers Postgres), `tests/fixtures/mailer.ts` (SES mock), `tests/fixtures/pii-corpus.ts` (PII corpus) are the canonical entry points; do not write parallel helpers.
- **Env defaults:** unit tests inherit `ENCRYPTION_KEY` / `CPF_HASH_PEPPER` / `NEXTAUTH_SECRET` defaults from `tests/setup.ts`; integration / e2e callers can override via `.env.test.local`.

## Docker / testcontainers Verification

Docker Desktop 29.1.3 with the WSL2 backend is available on this host; the integration scaffold test pulled `postgres:16-alpine` and booted in ~18 s on first run. No gotchas hit. CI will need Docker available; the integration test surface is opt-in via `pnpm test:integration` so unit + e2e remain runnable in environments without Docker.

## Verification Gate (final)

| Check                           | Result | Notes                                                                             |
| ------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | PASS  | Done in 1.6 s                                                                      |
| `pnpm typecheck`                | PASS  | After NODE_ENV cast fix                                                            |
| `pnpm build`                    | PASS  | Compiled in ~1.8 s, no warnings                                                    |
| `pnpm test:unit`                | PASS  | 1 test, 1.0 s                                                                      |
| `pnpm test:integration`         | PASS  | 1 test, 19.0 s (testcontainers Postgres 16-alpine)                                |
| `pnpm test:e2e`                 | PASS  | 1 test, 3.3 s (chromium, web server auto-spawned)                                  |
| `grep '--primary: 178 84% 28%'` | PASS  | UI-SPEC § 1.4 teal token survived shadcn init                                      |
| `grep '--radius: 0.375rem'`     | PASS  | UI-SPEC New York radius survived                                                   |
| Forbidden deps absent           | PASS  | `next-auth`, `@serwist/next`, `recharts`, `drizzle-kit push` not in package.json   |

## Self-Check: PASSED

All 35 created files exist on disk. All 4 commit hashes resolve in `git log`. Verified:

- `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.nvmrc`, `.gitignore`, `next-env.d.ts`, `components.json`, `vitest.config.ts`, `playwright.config.ts` — all present at repo root.
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/lib/utils.ts`, all 11 `src/components/ui/*.tsx` primitives — all present.
- `public/logo.svg` — present, 246 bytes.
- `tests/setup.ts`, `tests/fixtures/{db,mailer,pii-corpus}.ts`, scaffold tests in `tests/{unit,integration,e2e}/` — all present.
- Commits `f592a17`, `0020ca6`, `00ecf99`, `7885dfc` — all in `git log master`.
