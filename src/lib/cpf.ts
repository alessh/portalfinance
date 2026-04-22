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
