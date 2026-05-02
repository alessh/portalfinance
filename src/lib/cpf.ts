/**
 * CPF schema + formatter using `@brazilian-utils/brazilian-utils`.
 *
 * RESEARCH.md § Plan slice 01-02 item 5 / Pitfall 2 — the canonical
 * package is `@brazilian-utils/brazilian-utils`, NOT
 * `@brazilian-utils/br-validations` (which does not exist on npm).
 *
 * Phase 1 ships the schema and formatter so Phase 2 imports them
 * unchanged when CPF is actually collected at the first bank-connect
 * gate (D-04). CPF is NOT collected at signup in Phase 1.
 *
 * Phase 2 adds `encryptAndHashCPF` — convenience wrapper used in
 * /api/connect/init to atomically encrypt + hash the CPF before writing
 * to `users.cpf_enc` + `users.cpf_hash` (D-02, P28).
 */
import {
  isValidCPF,
  formatCPF as formatBrazilianCPF,
} from '@brazilian-utils/brazilian-utils';
import { z } from 'zod';
import { encryptCPF, hashCPF } from '@/lib/crypto';

export const CPFSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 11, { message: 'CPF deve ter 11 dígitos' })
  .refine((s) => isValidCPF(s), {
    message: 'CPF inválido (dígito verificador falhou)',
  });

export function formatCPF(cpf: string): string {
  return formatBrazilianCPF(cpf);
}

/**
 * Encrypt and hash a validated CPF string.
 *
 * Caller MUST pass an already-validated CPF (digits-only, 11 chars, check-digit OK).
 * Returns both fields needed for `users` UPDATE at first connect (D-02, P28):
 *   - `cpf_enc`  → AES-256-GCM ciphertext (iv || tag || ciphertext)
 *   - `cpf_hash` → HMAC-SHA-256 with CPF_HASH_PEPPER for uniqueness lookup
 *
 * NEVER call this before CPFSchema validation passes.
 */
export function encryptAndHashCPF(cpf: string): { cpf_enc: Buffer; cpf_hash: Buffer } {
  return {
    cpf_enc: encryptCPF(cpf),
    cpf_hash: hashCPF(cpf),
  };
}
