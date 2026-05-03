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
