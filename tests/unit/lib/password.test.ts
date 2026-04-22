import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';

/**
 * argon2id wrapper tests — RESEARCH.md § Plan slice 01-02 item 3 / OWASP-2025.
 *
 * Uses lower-cost parameters via the env-relaxed default in the function,
 * but still produces a `$argon2id$` prefix so the AUTH-06 grep assertion
 * passes against any hash this function generates.
 */
const SAMPLE_PASSWORD = 'Correct-Horse-1234';

describe('hashPassword / verifyPassword', () => {
  it('hash + verify round-trips successfully', async () => {
    const hash = await hashPassword(SAMPLE_PASSWORD);
    expect(await verifyPassword(hash, SAMPLE_PASSWORD)).toBe(true);
  }, 15_000);

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(SAMPLE_PASSWORD);
    expect(await verifyPassword(hash, 'Wrong-Password-999')).toBe(false);
  }, 15_000);

  it('produces a hash that starts with $argon2id$', async () => {
    const hash = await hashPassword(SAMPLE_PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  }, 15_000);

  it('returns false (without throwing) when no hash is provided', async () => {
    expect(await verifyPassword(undefined, SAMPLE_PASSWORD)).toBe(false);
    expect(await verifyPassword(null, SAMPLE_PASSWORD)).toBe(false);
  }, 15_000);

  it('returns false on an obviously malformed hash without throwing', async () => {
    expect(await verifyPassword('not-a-real-argon2-hash', SAMPLE_PASSWORD)).toBe(false);
  }, 15_000);
});
