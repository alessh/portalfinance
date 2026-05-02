/**
 * Consent scope configuration — UI-SPEC § 2.8 + D-16.
 *
 * One entry per ConsentScope value. The ConsentScreen component reads
 * from this config via getScopeConfig(scope) — it does NOT hardcode
 * data-point lists in JSX, so Phase 2 can add PLUGGY_CONNECTOR:* entries
 * here without touching the component.
 *
 * Phase 1 ships two entries:
 *   - ACCOUNT_CREATION: shown at signup (currently exercised by unit tests;
 *     Phase 2 is the first production consumer in the Pluggy connect flow)
 *   - PLUGGY_CONNECTOR_TEMPLATE: used for any PLUGGY_CONNECTOR:<id> scope
 */

export type ConsentScope =
  | 'ACCOUNT_CREATION'
  | 'PLUGGY_CONNECT_PENDING'
  | `PLUGGY_CONNECTOR:${string}`;

export interface ScopeConfig {
  title: string;
  dataPoints: string[];
  legalBasis: string;
}

const ACCOUNT_CREATION: ScopeConfig = {
  title: 'Suas informações estão protegidas',
  dataPoints: [
    'E-mail (para login e comunicações)',
    'Senha (armazenada de forma criptografada, nunca em texto puro)',
    'Dados de uso e sessões (para segurança da conta)',
  ],
  legalBasis: 'Base legal: Art. 7º, I da LGPD (consentimento)',
};

/**
 * Shown at the Pluggy connect flow before the user authorizes bank data
 * sharing. UI-SPEC § 3.2 verbatim text. (D-08, D-14)
 *
 * LGPD Art. 7º, I — consent basis: user actively clicks "Concordar e conectar".
 */
const PLUGGY_CONNECT_PENDING: ScopeConfig = {
  title: 'Conectar sua conta bancária',
  dataPoints: [
    'Saldos e detalhes da conta',
    'Histórico de transações (até 12 meses)',
    'Limites e datas de vencimento do cartão',
  ],
  legalBasis: 'Base legal: Art. 7º, I da LGPD (consentimento)',
};

/**
 * Per-connector disclosure — same copy as PLUGGY_CONNECT_PENDING.
 * Phase 2 records a per-connector scope (PLUGGY_CONNECTOR:<id>) in
 * user_consents AFTER the widget succeeds. The UI rendering reuses
 * the generic PLUGGY_CONNECT_PENDING config.
 */
const PLUGGY_CONNECTOR_TEMPLATE: ScopeConfig = {
  title: 'Conectar instituição financeira',
  dataPoints: [
    'Dados de conta: saldos e informações da conta',
    'Transações: histórico de movimentações financeiras',
    'Dados de produto: limites de cartão e datas de vencimento',
  ],
  legalBasis:
    'Base legal: Art. 7º, I da LGPD (consentimento) — renovável a qualquer momento',
};

export const consentScopes = {
  ACCOUNT_CREATION,
  PLUGGY_CONNECT_PENDING,
  PLUGGY_CONNECTOR_TEMPLATE,
} as const;

/**
 * Resolve a ConsentScope string to its ScopeConfig.
 *
 * Throws on unknown scopes so Phase 2 additions are always explicit
 * (T-CONSENT-SCOPE-COLLISION mitigation).
 */
export function getScopeConfig(scope: ConsentScope): ScopeConfig {
  if (scope === 'ACCOUNT_CREATION') return consentScopes.ACCOUNT_CREATION;
  if (scope === 'PLUGGY_CONNECT_PENDING') return consentScopes.PLUGGY_CONNECT_PENDING;
  // Per-connector row recorded post-widget; UI rendering reuses the generic
  // PLUGGY_CONNECT_PENDING disclosure (same LGPD basis, same data points).
  if (scope.startsWith('PLUGGY_CONNECTOR:'))
    return consentScopes.PLUGGY_CONNECT_PENDING;
  throw new Error(`Unknown consent scope: ${scope}`);
}
