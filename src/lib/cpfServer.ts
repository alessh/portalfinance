/**
 * Server-only CPF encryption + hash wrapper.
 *
 * Phase 2 / D-02 / P28 — used in /api/connect/init to atomically encrypt
 * + hash the CPF before writing to `users.cpf_enc` + `users.cpf_hash`.
 *
 * Caller MUST pass an already-validated CPF (digits-only, 11 chars,
 * check-digit OK — i.e., a value that has cleared `CPFSchema.safeParse`).
 *
 * SERVER-ONLY by `import 'server-only'` — any client bundle that
 * transitively imports this module fails the Next.js build.
 */
import 'server-only';
import { encryptCPF, hashCPF } from '@/lib/crypto';

export function encryptAndHashCPF(cpf: string): { cpf_enc: Buffer; cpf_hash: Buffer } {
  return {
    cpf_enc: encryptCPF(cpf),
    cpf_hash: hashCPF(cpf),
  };
}
