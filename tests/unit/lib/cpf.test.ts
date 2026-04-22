import { describe, it, expect } from 'vitest';
import { CPFSchema, formatCPF } from '@/lib/cpf';

/**
 * CPF schema tests — RESEARCH.md § Plan slice 01-02 item 5.
 *
 * Uses `@brazilian-utils/brazilian-utils` (NOT br-validations — that package
 * does not exist on npm). Reference CPF `52998224725` is the canonical
 * "valid example" CPF used by Brazilian Receita Federal documentation.
 */
describe('CPFSchema', () => {
  it('rejects all-ones CPF (repeating digits fail check digit)', () => {
    const result = CPFSchema.safeParse('111.111.111-11');
    expect(result.success).toBe(false);
  });

  it('rejects all-zero CPF (test placeholder)', () => {
    const result = CPFSchema.safeParse('00000000000');
    expect(result.success).toBe(false);
  });

  it('accepts a valid raw CPF and normalizes to digits-only', () => {
    const result = CPFSchema.safeParse('52998224725');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('52998224725');
    }
  });

  it('accepts a formatted CPF and normalizes to digits-only', () => {
    const result = CPFSchema.safeParse('529.982.247-25');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('52998224725');
    }
  });

  it('rejects a CPF that is not 11 digits', () => {
    const result = CPFSchema.safeParse('1234567890');
    expect(result.success).toBe(false);
  });
});

describe('formatCPF', () => {
  it('formats a raw CPF into the canonical Brazilian shape', () => {
    expect(formatCPF('52998224725')).toBe('529.982.247-25');
  });
});
