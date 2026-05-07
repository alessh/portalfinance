'use client';
/**
 * QueryProvider — global TanStack Query client provider for the App Router tree.
 *
 * Mounted once at the root layout so every client component below it can use
 * `useQuery`, `useMutation`, `useQueryClient`, etc. without throwing
 * "No QueryClient set, use QueryClientProvider to set one".
 *
 * Why a stable client via `useState`:
 *   On the client we want a single QueryClient instance that survives re-renders
 *   (otherwise the in-memory cache is wiped on every render). `useState` with a
 *   factory creates the client exactly once per browser session. This is the
 *   pattern recommended by TanStack for Next.js App Router (see
 *   https://tanstack.com/query/latest/docs/framework/react/guides/ssr).
 *
 * Defaults rationale:
 *   - `staleTime: 30s` — most reads in this app (sync-status, monthly summary,
 *     transactions) are server-cached or pre-aggregated; 30 s avoids hammering
 *     APIs while keeping the dashboard feeling live.
 *   - `gcTime: 5min` — keep recent caches around for fast back-nav.
 *   - `refetchOnWindowFocus: false` — financial dashboards do not need
 *     window-focus refetches; explicit refetch buttons + polling cover it.
 *   - `retry: 1` — single retry; surfaces real errors quickly to the UI.
 */
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [query_client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={query_client}>{children}</QueryClientProvider>;
}
