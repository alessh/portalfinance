/**
 * Unit tests — src/lib/pluggyItemStatus.ts (Plan 02-15, Concerns #6 + #7).
 *
 * Coverage:
 *   status-helper-1: isSyncableItemStatus matrix across all 6 enum values.
 *   status-helper-2: needsReauth matrix including the OUTDATED+executionStatus
 *                    drift case from Concern #6.
 *   status-helper-3: TypeScript exhaustiveness guard — passing a PluggyItemStatus
 *                    union into a switch with `never` fallback compiles iff every
 *                    case is handled. The compile-time check prevents a future
 *                    `'PAUSED'` (etc.) being added to the enum without updating
 *                    the helper.
 */
import { describe, it, expect } from 'vitest';
import {
  isSyncableItemStatus,
  needsReauth,
  syncSkipReason,
  type PluggyItemStatus,
} from '@/lib/pluggyItemStatus';

describe('pluggyItemStatus helpers', () => {
  it('status-helper-1: isSyncableItemStatus across all enum values', () => {
    expect(isSyncableItemStatus('UPDATED')).toBe(true);
    expect(isSyncableItemStatus('OUTDATED')).toBe(true);
    expect(isSyncableItemStatus('UPDATING')).toBe(false);
    expect(isSyncableItemStatus('LOGIN_ERROR')).toBe(false);
    expect(isSyncableItemStatus('WAITING_USER_INPUT')).toBe(false);
    expect(isSyncableItemStatus('DISCONNECTED')).toBe(false);
  });

  it('status-helper-2: needsReauth surfaces re-auth states + OUTDATED+ERROR', () => {
    expect(needsReauth('LOGIN_ERROR')).toBe(true);
    expect(needsReauth('WAITING_USER_INPUT')).toBe(true);

    expect(needsReauth('UPDATED')).toBe(false);
    expect(needsReauth('UPDATING')).toBe(false);
    expect(needsReauth('DISCONNECTED')).toBe(false);

    // OUTDATED handling — Concern #6 drift case.
    expect(needsReauth('OUTDATED', 'ERROR')).toBe(true);
    expect(needsReauth('OUTDATED', null)).toBe(false);
    expect(needsReauth('OUTDATED', undefined)).toBe(false);
    expect(needsReauth('OUTDATED', 'SUCCESS')).toBe(false);
  });

  it('status-helper-3: TypeScript exhaustiveness — switch over the union compiles', () => {
    // If a future enum value is added without updating syncSkipReason, the
    // `never` assertion in the helper's default branch fails compilation.
    // At runtime the helper still returns a string for every legal value:
    const all: PluggyItemStatus[] = [
      'UPDATING',
      'LOGIN_ERROR',
      'OUTDATED',
      'WAITING_USER_INPUT',
      'UPDATED',
      'DISCONNECTED',
    ];
    for (const s of all) {
      expect(typeof syncSkipReason(s)).toBe('string');
    }

    // Spot-check the canonical reason strings consumed by pluggySyncWorker.
    expect(syncSkipReason('UPDATING')).toBe('item_already_updating');
    expect(syncSkipReason('LOGIN_ERROR')).toBe('item_broken');
    expect(syncSkipReason('WAITING_USER_INPUT')).toBe('item_broken');
    expect(syncSkipReason('DISCONNECTED')).toBe('item_disconnected');
  });
});
