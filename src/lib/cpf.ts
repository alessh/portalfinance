/**
 * Isomorphic CPF schema + formatter using `@brazilian-utils/brazilian-utils`.
 *
 * RESEARCH.md § Plan slice 01-02 item 5 / Pitfall 2 — the canonical
 * package is `@brazilian-utils/brazilian-utils`, NOT
 * `@brazilian-utils/br-validations` (which does not exist on npm).
 *
 * **CLIENT-SAFE.** This module deliberately avoids any import of
 * `@/lib/crypto` or `@/lib/env` so it can be used from `'use client'`
 * components (e.g., ConsentScreen) without dragging the server-only
 * env loader into the browser bundle.
 *
 * The encryption wrapper that was previously co-located here lives in
 * `@/lib/cpfServer` (server-only), imported separately by API routes
 * that need to write to `users.cpf_enc` / `users.cpf_hash`.
 */
import {
  isValidCPF,
  formatCPF as formatBrazilianCPF,
} from '@brazilian-utils/brazilian-utils';
import { z } from 'zod';

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
 * CPF storage byte-length contract (review WR-02).
 *
 * `users.cpf_enc` is a `bytea` column whose length encodes whether the user
 * has set a real CPF or is still carrying the signup placeholder:
 *
 *   - {@link CPF_PLACEHOLDER_BYTES} (44 bytes): random placeholder written by
 *     `signupCore` (Plan 02-01). User has NOT yet set a real CPF.
 *   - {@link CPF_ENCRYPTED_BYTES} (39 bytes): real AES-256-GCM payload —
 *     12 (iv) + 16 (tag) + 11 (CPF digits) = 39. User has set a real CPF.
 *
 * `/api/connect/init` (Plan 02-03 D-08) compares against
 * {@link CPF_ENCRYPTED_BYTES} to decide whether to demand a CPF on the
 * connect screen. If `signupCore` ever changes the placeholder shape, BOTH
 * constants must move in lockstep AND the unit tests in
 * `tests/unit/lib/cpf.test.ts` will fail loudly.
 */
export const CPF_PLACEHOLDER_BYTES = 44;
export const CPF_ENCRYPTED_BYTES = 39;

/**
 * Single source of truth for "this user has set a real CPF" (review WR-02 follow-up).
 *
 * Compares `cpf_enc.byteLength` to {@link CPF_ENCRYPTED_BYTES} so any future
 * change to the placeholder shape fails closed (returns `false`) instead of
 * silently flipping open. Both `/api/connect/init` and `app/connect/page.tsx`
 * MUST use this helper — using `cpf_hash` is unsafe because `signupCore`
 * writes a non-null random `cpf_hash` placeholder at user creation.
 */
export function userHasRealCpf(cpf_enc: Buffer | Uint8Array | null | undefined): boolean {
  return !!cpf_enc && cpf_enc.byteLength === CPF_ENCRYPTED_BYTES;
}
