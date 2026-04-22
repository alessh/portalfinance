import { describe, it, expect } from 'vitest';
import { encryptCPF, decryptCPF, hashCPF } from '@/lib/crypto';

/**
 * AES-256-GCM + HMAC-SHA-256 helper tests — RESEARCH.md § Plan slice 01-02 item 4.
 *
 * The test setup file (tests/setup.ts) seeds a deterministic 32-byte
 * ENCRYPTION_KEY (Buffer.alloc(32, 1)) and a stable CPF_HASH_PEPPER. Both
 * are safe defaults for tests only — production uses real Railway env vars.
 */
const SAMPLE_CPF = '52998224725';

describe('encryptCPF / decryptCPF', () => {
  it('round-trips a CPF through AES-256-GCM unchanged', () => {
    const blob = encryptCPF(SAMPLE_CPF);
    expect(decryptCPF(blob)).toBe(SAMPLE_CPF);
  });

  it('produces 12-byte IV + 16-byte tag + ciphertext (>= 28+11 bytes)', () => {
    const blob = encryptCPF(SAMPLE_CPF);
    // 12 (IV) + 16 (auth tag) + 11 (CPF length, AES-GCM keeps plaintext length)
    expect(blob.byteLength).toBeGreaterThanOrEqual(12 + 16 + 11);
  });

  it('rejects a tampered authentication tag at decrypt time', () => {
    const blob = encryptCPF(SAMPLE_CPF);
    // The auth tag occupies bytes 12..28. Flip a byte inside it.
    const tampered = Buffer.from(blob);
    tampered[15] = tampered[15] ^ 0xff;
    expect(() => decryptCPF(tampered)).toThrow();
  });

  it('produces a different blob each call (random IV)', () => {
    const a = encryptCPF(SAMPLE_CPF);
    const b = encryptCPF(SAMPLE_CPF);
    // IVs differ, so the byte arrays must differ even for identical plaintext.
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});

describe('hashCPF', () => {
  it('is deterministic for the same input', () => {
    const a = hashCPF(SAMPLE_CPF);
    const b = hashCPF(SAMPLE_CPF);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it('produces a 32-byte digest (HMAC-SHA-256)', () => {
    expect(hashCPF(SAMPLE_CPF).byteLength).toBe(32);
  });

  it('produces different digests for different inputs', () => {
    const a = hashCPF('52998224725');
    const b = hashCPF('11144477735');
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
});
