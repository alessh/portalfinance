---
slug: no-queryclient-connect-success
status: resolved
trigger: "Uncaught Error: No QueryClient set, use QueryClientProvider to set one at SyncProgressCard in /connect/success page"
created: 2026-05-07T16:28:31Z
updated: 2026-05-07T16:45:00Z
---

# Debug Session: no-queryclient-connect-success

## Symptoms

- **Expected behavior:** /connect/success page renders SyncProgressCard which polls sync status via TanStack Query.
- **Actual behavior:** Browser throws `Uncaught Error: No QueryClient set, use QueryClientProvider to set one` at SyncProgressCard render.
- **Error message:**
  ```
  GET /connect/success 200 in 2.6s (next.js: 1776ms, application-code: 863ms)
  [browser] Uncaught Error: No QueryClient set, use QueryClientProvider to set one
      at SyncProgressCard (.next\dev\static\chunks\src_133jjrg._.js:230:213)
      at ConnectSuccessPage (src\app\connect\success\page.tsx:28:9)
    26 |     <main className="min-h-screen flex items-center justify-center p-4">
    27 |       <div className="w-full max-w-[440px] shadow-md rounded-xl p-8">
    28 |         <SyncProgressCard />
    29 |       </div>
    30 |     </main>
    31 |   );
  ```
- **Timeline:** Newly observed during dev session post Pluggy connect flow build.
- **Reproduction:** Navigate to /connect/success in dev server.

## Current Focus

- hypothesis: SyncProgressCard uses `useQuery`/`useMutation` from TanStack Query but the route subtree (or app root) is missing a QueryClientProvider wrapper.
- test: Inspect SyncProgressCard imports + locate global QueryClientProvider in src/app/layout.tsx or providers.
- expecting: Either no providers file, or providers exist but ConnectSuccessPage tree does not consume it.
- next_action: (resolved)

## Evidence

- timestamp: 2026-05-07T16:40:00Z — Read `src/app/connect/success/page.tsx`. It is a server component (`async function ConnectSuccessPage`) that gates on `requireSession()` then renders `<SyncProgressCard />`. No provider in this subtree.
- timestamp: 2026-05-07T16:40:30Z — Read `src/components/connect/SyncProgressCard.tsx`. Has `'use client'` directive (line 1). Imports `useQuery` from `@tanstack/react-query` (line 19) and calls it at line 79 with `queryKey: ['sync-status']`, `refetchInterval: 2000`. Component itself is correctly client-side.
- timestamp: 2026-05-07T16:41:00Z — Read `src/app/layout.tsx`. Root layout renders `{children}` directly inside `<body>` with NO provider wrapping. No imports from `@tanstack/react-query`.
- timestamp: 2026-05-07T16:41:30Z — Grep `QueryClientProvider` across whole repo: zero matches in `src/`. Grep `QueryClient` in `src/`: zero matches. Grep `@tanstack/react-query` in `src/`: only `SyncProgressCard.tsx`.
- timestamp: 2026-05-07T16:42:00Z — `package.json` has `@tanstack/react-query: ^5.100.8` installed.
- timestamp: 2026-05-07T16:42:15Z — `src/components/providers/` directory does not yet exist.
- timestamp: 2026-05-07T16:42:30Z — Only one TanStack Query consumer in entire `src/` tree (SyncProgressCard).

## Eliminated

- Server-component boundary swallowing a client provider — ruled out: there is no provider anywhere, so the question of boundary placement is moot.
- Wrong route group / nested layout overriding providers — ruled out: only one `layout.tsx` exists at app root, and it has no providers.
- `'use client'` missing on SyncProgressCard — ruled out: directive is present at line 1.

## Resolution

**Root cause:** The application has TanStack Query v5 installed and consumed by `SyncProgressCard`, but no `QueryClientProvider` is mounted anywhere in the React tree. The root layout (`src/app/layout.tsx`) renders `{children}` directly inside `<body>` with no providers wrapper. This is a foundational scaffolding gap — the first TanStack Query consumer (the new Plan 02-03 SyncProgressCard) exposed it.

**Fix:**
1. Created `src/components/providers/QueryProvider.tsx` — a `'use client'` component that instantiates a stable `QueryClient` via `useState` factory (per TanStack's App Router guidance) with project-appropriate defaults: `staleTime: 30s`, `gcTime: 5min`, `refetchOnWindowFocus: false`, `retry: 1`.
2. Imported and mounted `<QueryProvider>` around `{children}` inside `<body>` in `src/app/layout.tsx`.

**Validation:**
- `npx tsc --noEmit` passes clean.
- Provider is mounted at the root, so every client component (current and future) is covered.
- `useState` factory pattern guarantees a single `QueryClient` per browser session — caches survive re-renders, no SSR cross-request leakage.

**Files changed:**
- `src/components/providers/QueryProvider.tsx` (new)
- `src/app/layout.tsx` (added import + wrapped children)
