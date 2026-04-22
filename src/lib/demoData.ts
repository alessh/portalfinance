/**
 * Hard-coded BR middle-class sample data for the demo dashboard.
 *
 * Plan 01-04 — D-03, UI-SPEC § 2.10.
 *
 * These numbers are deliberately plausible for Brazilian middle-class
 * spending patterns (D-03, 01-CONTEXT.md Specifics):
 *   - R$ 6.500 salário via PIX (common for CLT workers)
 *   - R$ 2.800 moradia (aluguel + condomínio + IPTU fraction)
 *   - R$ 1.200 mercado (family grocery bill)
 *   - R$   450 alimentação (iFood / delivery)
 *   - R$   220 transporte (gasolina ou cartão de crédito CPTM/Metrô)
 *   - R$   230 outros (streaming, farmácia, etc.)
 *
 * Total expenses: R$ 4.900 | Net: R$ 1.600 | Month: April 2026
 *
 * NEVER query the database here — this is purely illustrative data that
 * shows new users what Portal Finance will look like once they connect
 * their bank account. Phases 2–4 replace this with real aggregated data.
 */

export interface DemoCategory {
  name: string;
  amount: number;
  icon: string;
  percentage: number;
}

export interface DemoData {
  readonly month: string;
  readonly receita_total: number;
  readonly despesas_total: number;
  readonly net: number;
  readonly categories: readonly DemoCategory[];
}

export const demoData: DemoData = {
  month: 'Abril 2026',
  receita_total: 6500.00,
  despesas_total: 4900.00,
  net: 1600.00,
  categories: [
    { name: 'Moradia',     amount: 2800.00, icon: 'home',             percentage: 57 },
    { name: 'Mercado',     amount: 1200.00, icon: 'shopping-cart',    percentage: 24 },
    { name: 'Alimentação', amount:  450.00, icon: 'utensils',         percentage:  9 },
    { name: 'Transporte',  amount:  220.00, icon: 'car',              percentage:  4 },
    { name: 'Outros',      amount:  230.00, icon: 'more-horizontal',  percentage:  5 },
  ],
} as const;
