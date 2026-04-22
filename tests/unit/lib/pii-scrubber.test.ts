/**
 * Unit tests for src/lib/piiScrubber.ts
 * Plan 01-03 — Task 1 (TDD RED phase)
 *
 * Covers 8 behaviors defined in 01-03-PLAN.md <behavior> section.
 */
import { describe, it, expect } from 'vitest';
import { scrubString, scrubObject } from '@/lib/piiScrubber';

describe('scrubString', () => {
  it('Test 1: strips formatted CPF from a string', () => {
    const result = scrubString('CPF 123.456.789-00 entrou');
    expect(result).toBe('CPF [CPF] entrou');
  });

  it('Test 2: strips raw 11-digit CPF from a string', () => {
    const result = scrubString('12345678900 bare');
    expect(result).toBe('[CPF] bare');
  });

  it('Test 3: strips email from a string', () => {
    const result = scrubString('Contato user@example.com hoje');
    expect(result).toContain('[EMAIL]');
    expect(result).not.toContain('user@example.com');
  });

  it('Test 4: strips Brazilian phone from a string', () => {
    const result = scrubString('Ligue +55 11 98765-4321');
    expect(result).toContain('[PHONE]');
  });

  it('Test 5: strips BR account number from a string', () => {
    const result = scrubString('Ag. 12345-6 conta');
    expect(result).toContain('[ACCOUNT]');
  });

  it('Test 8: is bounded on 50_000 char input (ReDoS guard)', () => {
    const long_input = 'a'.repeat(50_000);
    const start = Date.now();
    scrubString(long_input);
    const elapsed = Date.now() - start;
    // Should complete in under 2000ms (any value will do, but should not hang)
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('scrubObject', () => {
  it('Test 6: key-based and string-rule redaction on nested objects', () => {
    const input = {
      user: {
        cpf: '12345678900',
        email: 'a@b.com',
        nested: ['PIX JOAO SILVA 111.222.333-44'],
      },
    };
    const result = scrubObject(input);
    // key-based redaction
    expect(result.user.cpf).toBe('[REDACTED]');
    expect(result.user.email).toBe('[REDACTED]');
    // string-rule redaction on array element
    expect(result.user.nested[0]).toContain('[CPF]');
  });

  it('Test 7: handles circular references without infinite loop', () => {
    const obj: Record<string, unknown> = { name: 'safe' };
    obj['self'] = obj; // circular reference
    // Should not throw or hang
    expect(() => scrubObject(obj)).not.toThrow();
    const result = scrubObject(obj) as Record<string, unknown>;
    expect(result['name']).toBe('safe');
  });
});
