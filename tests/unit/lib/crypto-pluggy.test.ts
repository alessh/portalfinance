/**
 * hashPluggyItemId() — TDD unit tests (Tests 7-9 from 02-02 plan).
 *
 * RESEARCH.md OQ#6 RESOLVED: A distinct pepper (PLUGGY_ITEM_ID_HASH_PEPPER)
 * is required so hashPluggyItemId != hashCPF even for the same input string.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

// Set env before importing crypto so env.ts parses with the pepper present.
beforeAll(() => {
  vi.stubEnv('PLUGGY_ITEM_ID_HASH_PEPPER', 'test-pluggy-pepper-at-least-32-chars-xxxx');
  vi.stubEnv('CPF_HASH_PEPPER', 'test-cpf-pepper-at-least-32-chars-xxxxx');
});

// Dynamic import so env stubs are applied before module load.
async function getCrypto() {
  // Reset module registry so re-import picks up updated env.
  vi.resetModules();
  return import('@/lib/crypto');
}

describe('hashPluggyItemId', () => {
  it('Test 7: same input produces equal buffers (determinism)', async () => {
    const { hashPluggyItemId } = await getCrypto();
    const a = hashPluggyItemId('item-abc-123');
    const b = hashPluggyItemId('item-abc-123');
    expect(a.equals(b)).toBe(true);
  });

  it('Test 8: different inputs produce different buffers; length is 32', async () => {
    const { hashPluggyItemId } = await getCrypto();
    const a = hashPluggyItemId('item-a');
    const b = hashPluggyItemId('item-b');
    expect(a.equals(b)).toBe(false);
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
  });

  it('Test 9: hashPluggyItemId and hashCPF return different digests for the same input (distinct peppers)', async () => {
    const { hashPluggyItemId, hashCPF } = await getCrypto();
    const shared = 'shared-string';
    const fromPluggy = hashPluggyItemId(shared);
    const fromCPF = hashCPF(shared);
    expect(fromPluggy.equals(fromCPF)).toBe(false);
  });
});
