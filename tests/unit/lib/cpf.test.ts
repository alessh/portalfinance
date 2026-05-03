import { describe, it, expect } from 'vitest';
import {
  CPFSchema,
  formatCPF,
  CPF_PLACEHOLDER_BYTES,
  CPF_ENCRYPTED_BYTES,
} from '@/lib/cpf';

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

/**
 * Pin the cpf_enc byte-length contract used by /api/connect/init (review
 * WR-02). If signupCore ever changes the placeholder shape OR encryptCPF
 * changes the AES-GCM payload shape, these tests fail loudly so the
 * connect-init `has_cpf` detection cannot silently flip open.
 */
describe('CPF storage byte-length contract', () => {
  it('pins the signup placeholder length to 44 bytes', () => {
    expect(CPF_PLACEHOLDER_BYTES).toBe(44);
  });

  it('pins the AES-256-GCM CPF payload length to 39 bytes (12 iv + 16 tag + 11 cpf)', () => {
    expect(CPF_ENCRYPTED_BYTES).toBe(39);
  });

  it('keeps placeholder and encrypted lengths distinct so connect-init can disambiguate', () => {
    expect(CPF_PLACEHOLDER_BYTES).not.toBe(CPF_ENCRYPTED_BYTES);
  });
});
