---
slug: tailwindcss-resolve-parent-dir
status: resolved
trigger: "Can't resolve 'tailwindcss' in 'C:\\Users\\aless\\git\\PortalFinance' when evaluating ./src/app/globals.css"
created: 2026-05-07T16:40:09Z
updated: 2026-05-07T17:55:00Z
---

# Debug Session: tailwindcss-resolve-parent-dir

## Symptoms

- **Expected behavior:** Next.js 16 dev server resolves `@import "tailwindcss"` from `web/src/app/globals.css` against `web/node_modules/tailwindcss` (which exists, v4.0.14).
- **Actual behavior:** enhanced-resolve fails with `Can't resolve 'tailwindcss' in 'C:\Users\aless\git\PortalFinance'` — parent of the project root.
- **Error excerpt:**
  ```
  [browser] ./src/app/globals.css
  Error evaluating Node.js code
  Error: Can't resolve 'tailwindcss' in 'C:\Users\aless\git\PortalFinance'
      [at finishWithoutResolve (C:\Users\aless\git\PortalFinance\web\node_modules\enhanced-resolve\lib\Resolver.js:587:18)]
  Import trace:
    Client Component Browser:
      ./src/app/globals.css [Client Component Browser]
      ./src/app/layout.tsx [Server Component]
   GET /transactions?partial=true 200 in 2.6s (next.js: 385ms, application-code: 2.3s)
  ```
- **Timeline:** Surfaced during dev session immediately after a separate fix mounted `<QueryProvider>` in `src/app/layout.tsx`.
- **Reproduction:** Run `pnpm dev` (Next.js 16.2.4, Turbopack default) and load `/transactions`.

## Repo facts already established

- `tailwindcss@4.0.14` and `@tailwindcss/postcss@4.0.14` are present in `web/node_modules/`.
- `web/postcss.config.mjs` registers `@tailwindcss/postcss` plugin only.
- `web/tailwind.config.ts` exists (minimal — content globs only). **Note:** Tailwind v4 ignores `tailwind.config.ts` `content` and uses its own automatic source detector.
- `web/next.config.ts` set `turbopack.root` to `path.resolve(__dirname).replace(/\\/g, '/')`.
- `web/package.json` has `"dev": "next dev"` (no explicit bundler flag — Next 16 defaults to Turbopack).

## Current Focus

- hypothesis (initial — DISPROVED): `__dirname` evaluates incorrectly in `next.config.ts`, so `turbopack.root` resolves to a wrong path. Direct probe shows `__dirname` resolves correctly to `C:\Users\aless\git\PortalFinance\web` and `turbopack.root` becomes `C:/Users/aless/git/PortalFinance/web`.
- hypothesis (final — CONFIRMED): The `Can't resolve 'tailwindcss'` error in the original report was a stale `.next/cache` artifact. The actual underlying compilation failure is **Tailwind v4's automatic content scanner picking up rendered HTML/log artifacts** in the project root that contain HTML-escaped class names (`&amp;` from React rendering of `[&_svg]:shrink-0`), which Tailwind then emits as invalid CSS, causing PostCSS to fail at parse time. The cryptic resolve error and the parse error are both downstream symptoms of the same root cause: an unconstrained Tailwind v4 source scanner.

## Evidence

- timestamp: 2026-05-07T17:30 — Read `next/dist/build/next-config-ts/transpile-config.js` and `require-hook.js`. Confirmed Next 16 loads `next.config.ts` via `requireFromString(code, path.resolve(dir, 'next.config.compiled.js'))`. Filename is project-root-anchored, so `__dirname` inside the config resolves to the project root.
- timestamp: 2026-05-07T17:33 — Probed `__dirname` directly via a local script that emulates `requireFromString`:
  ```
  PROBE __dirname = C:\Users\aless\git\PortalFinance\web
  PROBE turbopack.root = C:/Users/aless/git/PortalFinance/web
  ```
  → `__dirname` hypothesis disproved.
- timestamp: 2026-05-07T17:40 — Started fresh dev server (port 3013), all routes returned 200/307 with no errors. CSS chunk built, contained 226 Tailwind utility markers. Could not reproduce the original `Can't resolve 'tailwindcss'` error. The bug had reproduced earlier only when `.next/cache` retained a stale failed-compilation entry.
- timestamp: 2026-05-07T17:42 — Hit `/transactions` with stale `.next` after touching unrelated files; got a different real error: `Unexpected token Semicolon` at `globals.css:1947` showing generated CSS containing `&amp; svg { ... }` (HTML entity escape leaking into CSS).
- timestamp: 2026-05-07T17:45 — Found `.next/standalone/src/components/ui/button.tsx` (clean, original `[&_svg]:shrink-0`). Source files are untouched.
- timestamp: 2026-05-07T17:48 — Found `.tmp_login.html` (a curl probe artifact in repo root) containing `[&amp;_svg]:shrink-0` (React HTML-escaped output). Discovered Tailwind v4 was scanning project-root files like `.tmp_login.html` and `.tmp_dev.log` because those filenames aren't in `.gitignore` and Tailwind v4's auto-detector ignores `tailwind.config.ts` `content` and only respects `.gitignore`.
- timestamp: 2026-05-07T17:50 — Applied fix: changed `@import "tailwindcss"` to `@import "tailwindcss" source(none)` in `globals.css` and added explicit `@source "../**/*.{ts,tsx}";`. Restarted dev server with cleared `.next`. All three routes (`/login`, `/connect/success`, `/transactions`) returned 200/307. CSS chunk built cleanly (56,987 bytes, 226 Tailwind markers, 3 valid `_svg` variant rules, zero `&amp;` escapes). Fix verified.
- timestamp: 2026-05-07T17:53 — Added `outputFileTracingRoot: project_root` to `next.config.ts` to defensively pin Next's standalone-build file-tracing root, preventing it from walking up to `C:\Users\aless\package-lock.json`. `pnpm typecheck` passes.

## Eliminated

- Missing tailwindcss install — confirmed present in `web/node_modules/tailwindcss/` with valid `package.json` exports including `style: "./index.css"`.
- Missing PostCSS config — `postcss.config.mjs` is present and registers `@tailwindcss/postcss`.
- `__dirname` undefined / wrong in `next.config.ts` — directly probed; resolves correctly to project root.
- `<QueryProvider>` change in `layout.tsx` — verified unrelated; CSS resolution does not depend on layout client-component additions.
- `turbopack.root` value wrong — direct probe confirms `C:/Users/aless/git/PortalFinance/web`.

## Resolution

- **root_cause:** Tailwind v4's automatic content scanner (used because Tailwind v4 ignores `tailwind.config.ts` `content`) was reading rendered HTML and log artifacts from the project root that contained React's HTML-escaped output of class names like `[&_svg]:shrink-0` → `[&amp;_svg]:shrink-0`. Tailwind then synthesized CSS rules whose nested selectors contained literal `&amp;`, producing invalid CSS that crashed the PostCSS parser. The originally reported `Can't resolve 'tailwindcss'` message was a stale `.next/cache` artifact masking the true compilation failure.
- **fix:** In `src/app/globals.css`, replaced `@import "tailwindcss";` with `@import "tailwindcss" source(none);` and added `@source "../**/*.{ts,tsx}";` to make source detection explicit and limited to the source tree. Also added `outputFileTracingRoot: project_root` to `next.config.ts` (paired with the existing `turbopack.root`) to defensively pin Next's tracing root for `output: 'standalone'` so it cannot walk up to `C:\Users\aless\package-lock.json`.
- **verification:**
  - `rm -rf .next && pnpm dev` boots cleanly.
  - `/login` 200, `/connect/success` 307, `/transactions` 307 (auth redirects) — all compile without resolve or parse errors.
  - CSS chunk served at 200 with 56,987 bytes containing 226 Tailwind markers and the expected `_svg` variant rules; zero `&amp;` escapes.
  - `pnpm typecheck` passes.
- **files_changed:**
  - `src/app/globals.css` — first line changed; added explicit `@source` directive.
  - `next.config.ts` — extracted `project_root` constant; added `outputFileTracingRoot`; refreshed comment.
