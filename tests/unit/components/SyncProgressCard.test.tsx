/**
 * Unit tests for src/components/connect/SyncProgressCard.tsx
 *
 * Plan 02-03 — Task 2 (sync-progress-1..3).
 *
 * Covers 3 behaviors:
 *   - sync-progress-1: useQuery configured with refetchInterval=2000.
 *   - sync-progress-2: on data.phase==='completed', router.push('/transactions').
 *   - sync-progress-3: after 60s elapsed without completion, router.push('/transactions?partial=true').
 *
 * Mocking strategy:
 *   - @tanstack/react-query: mock useQuery to return controlled data.
 *   - next/navigation: mock useRouter with a spy on push.
 *   - Timers: use vi.useFakeTimers() for 60s timeout test.
 *
 * Note: The refetchInterval value is verified by capturing the useQuery call options
 * passed by the component.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockRouterPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// We will override this per test.
let mockUseQueryResult: { data: { phase: string; transactions_count: number } | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: true,
};
// Capture the options passed to useQuery.
let capturedQueryOptions: { refetchInterval?: number } = {};

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { refetchInterval?: number; queryFn?: () => unknown; queryKey?: unknown[] }) => {
    capturedQueryOptions = options;
    return mockUseQueryResult;
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncProgressCard', () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
    capturedQueryOptions = {};
    mockUseQueryResult = { data: undefined, isLoading: true };
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sync-progress-1: useQuery is configured with refetchInterval=2000', async () => {
    const { SyncProgressCard } = await import('@/components/connect/SyncProgressCard');

    render(<SyncProgressCard />);

    expect(capturedQueryOptions.refetchInterval).toBe(2000);
  });

  it('sync-progress-2: on data.phase===completed, router.push(/transactions) is called once', async () => {
    const { SyncProgressCard } = await import('@/components/connect/SyncProgressCard');

    // Set up query to return 'completed'.
    mockUseQueryResult = {
      data: { phase: 'completed', transactions_count: 5 },
      isLoading: false,
    };

    await act(async () => {
      render(<SyncProgressCard />);
    });

    // Give effects time to run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockRouterPush).toHaveBeenCalledWith('/transactions');
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
  });

  it('sync-progress-3: after 60s elapsed without completion, router.push(/transactions?partial=true)', async () => {
    // Use fake timers to control elapsed_ms.
    vi.useFakeTimers();

    const { SyncProgressCard } = await import('@/components/connect/SyncProgressCard');

    // Query stays in 'connecting' phase (never completes).
    mockUseQueryResult = {
      data: { phase: 'connecting', transactions_count: 0 },
      isLoading: false,
    };

    await act(async () => {
      render(<SyncProgressCard />);
    });

    // Advance timers by 60 seconds using async variant so React state flushes
    // between each timer tick (setInterval fires → setElapsed_ms → re-render → useEffect).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // Verify router.push('/transactions?partial=true') was called.
    expect(mockRouterPush).toHaveBeenCalledWith('/transactions?partial=true');
    expect(mockRouterPush).not.toHaveBeenCalledWith('/transactions');
  }, 15_000);
});
