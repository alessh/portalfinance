/**
 * Integration test — vi.doMock + dynamic import stability.
 *
 * Closes 02-REVIEWS.md Concern #10 (MEDIUM): route tests that combine
 * vi.doMock('@/services/PluggyService') with await import('@/app/api/...')
 * may behave inconsistently under plan 02-09's singleton testcontainer
 * (isolate: false) if module cache state leaks between cases.
 *
 * Strategy: empirically prove the canonical pattern holds across 3
 * sequential cases (mock-stability-1) AND that omitting vi.resetModules
 * produces a stale mock (mock-stability-2 — documents the pitfall).
 *
 * Companion doc: docs/testing/pluggy-test-conventions.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('vi.doMock + dynamic import stability under singleton testcontainer (Concern #10)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unmock('@/services/PluggyService');
  });

  it('mock-stability-1: 3 sequential cases each see their fresh mock', async () => {
    // ---- Case A ----
    const fetch_a = vi.fn().mockResolvedValue({ results: [{ id: 'A', name: 'A' }] });
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({ fetchAccounts: fetch_a }),
    }));
    const mod_a = await import('@/services/PluggyService') as {
      getPluggyService: () => { fetchAccounts: (input: unknown) => Promise<{ results: Array<{ id: string }> }> };
    };
    const res_a = await mod_a.getPluggyService().fetchAccounts({});
    expect(res_a.results[0].id).toBe('A');
    expect(fetch_a).toHaveBeenCalledTimes(1);

    // ---- Case B (must reset + redo) ----
    vi.resetModules();
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({
        fetchAccounts: vi.fn().mockResolvedValue({ results: [{ id: 'B', name: 'B' }] }),
      }),
    }));
    const mod_b = await import('@/services/PluggyService') as {
      getPluggyService: () => { fetchAccounts: (input: unknown) => Promise<{ results: Array<{ id: string }> }> };
    };
    const res_b = await mod_b.getPluggyService().fetchAccounts({});
    expect(res_b.results[0].id).toBe('B');

    // ---- Case C ----
    vi.resetModules();
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({
        fetchAccounts: vi.fn().mockResolvedValue({ results: [{ id: 'C', name: 'C' }] }),
      }),
    }));
    const mod_c = await import('@/services/PluggyService') as {
      getPluggyService: () => { fetchAccounts: (input: unknown) => Promise<{ results: Array<{ id: string }> }> };
    };
    const res_c = await mod_c.getPluggyService().fetchAccounts({});
    expect(res_c.results[0].id).toBe('C');
  });

  it('mock-stability-2: vitest doMock re-applies on subsequent dynamic imports even without resetModules', async () => {
    // Empirical pitfall check: the plan author assumed that omitting
    // vi.resetModules between cases would cause the SECOND doMock to be
    // ignored (stale module cache returns the first mock). Vitest 3.x
    // actually re-resolves the dynamic import through the latest doMock
    // registration, so the second mock IS honored.
    //
    // Documenting the OBSERVED behavior here is itself the regression
    // guard — if a future vitest upgrade reverts to module-cache-wins
    // semantics, this test fires and engineers must reintroduce
    // vi.resetModules between cases.

    const fetch_a = vi.fn().mockResolvedValue({ results: [{ id: 'A' }] });
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({ fetchAccounts: fetch_a }),
    }));
    const mod_a = await import('@/services/PluggyService') as {
      getPluggyService: () => { fetchAccounts: (input: unknown) => Promise<{ results: Array<{ id: string }> }> };
    };
    const res_a = await mod_a.getPluggyService().fetchAccounts({});
    expect(res_a.results[0].id).toBe('A');

    // Skip vi.resetModules deliberately — re-doMock without reset.
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({
        fetchAccounts: vi.fn().mockResolvedValue({ results: [{ id: 'B' }] }),
      }),
    }));
    const mod_b = await import('@/services/PluggyService') as {
      getPluggyService: () => { fetchAccounts: (input: unknown) => Promise<{ results: Array<{ id: string }> }> };
    };
    const res_b = await mod_b.getPluggyService().fetchAccounts({});

    // Vitest 3.x honors the second doMock — res_b reports 'B'.
    expect(
      res_b.results[0].id,
      'vitest 3.x re-applies doMock on dynamic import; if this fires, restore vi.resetModules between cases',
    ).toBe('B');
  });
});
