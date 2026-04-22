/**
 * Currency formatting utilities for Portal Finance.
 *
 * Plan 01-04 — UI-SPEC § 2.10 (demo dashboard) + § Typography.
 *
 * IMPORTANT: Never concatenate `R$ ` manually. Use Intl.NumberFormat with
 * `pt-BR` locale so currency formatting is correct across all amounts,
 * including values >= 1000 (which use `.` as thousands separator in Brazil)
 * and negative values (net deficit scenarios).
 */

/**
 * Format a BRL (Real) amount using the pt-BR locale.
 *
 * Examples:
 *   formatBRL(6500)    → "R$ 6.500,00"
 *   formatBRL(450)     → "R$ 450,00"
 *   formatBRL(-1600)   → "-R$ 1.600,00"
 */
export function formatBRL(amount: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount);
}
