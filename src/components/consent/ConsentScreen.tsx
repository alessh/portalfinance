'use client';
/**
 * ConsentScreen — UI-SPEC § 2.8 (Phase 1) + § 3.2 (Phase 2 Extension).
 *
 * Reusable consent gate supporting three scope families:
 *   - ACCOUNT_CREATION: signup flow (Phase 1).
 *   - PLUGGY_CONNECT_PENDING: pre-widget consent with inline CPF capture (Phase 2).
 *   - PLUGGY_CONNECTOR:{id}: per-connector disclosure (Phase 2).
 *
 * **Phase 2 additions:**
 *   - `hasCpf` prop: when false AND scope is PLUGGY_CONNECT_PENDING, renders an
 *     inline CPF field between data-points and the consent checkbox (D-02).
 *   - `ctaLabel` prop: overrides the default CTA copy ("Concordar e continuar").
 *   - `cpfError` prop: server-side CPF validation error surfaced inline.
 *   - `cancelHref` prop: navigates back on "Não conectar agora" click.
 *   - `collapsibleDetails` prop: renders a <details> block for legal citations (D-14).
 *   - `onSubmit` replaces `onConsent`: receives `{ granted, cpf?, ip_address?, user_agent? }`.
 *
 * **Checkbox note (Phase 1 plan 01-02 finding):**
 * Radix Checkbox is aria-hidden, breaking React Hook Form `register()`.
 * Native `<input type="checkbox">` is used throughout this component.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { type ConsentScope, getScopeConfig } from '@/lib/consentScopes';
import { CPFSchema } from '@/lib/cpf';

export interface ConsentScreenProps {
  scope: ConsentScope;
  /** Phase 2: receives CPF when field shown; always receives granted=true. */
  onSubmit?: (data: { granted: boolean; cpf?: string; ip_address?: string; user_agent?: string }) => Promise<void>;
  /** Phase 1 backward-compat: called with the consent timestamp. If provided and onSubmit is absent, used as the handler. */
  onConsent?: (consentedAt: Date) => void;
  onDecline?: () => void;
  isLoading?: boolean;
  isSubmitting?: boolean;
  /** Phase 2: server-injected. When true, hides the inline CPF field (D-02). */
  hasCpf?: boolean;
  /** Phase 2: overrides default CTA label. */
  ctaLabel?: string;
  /** Phase 2: server-side CPF validation error shown inline. */
  cpfError?: string | null;
  /** Phase 2: href for the ghost cancel CTA. Default: '/'. */
  cancelHref?: string;
  /** Phase 2: when provided, renders a <details> block for LGPD legal citations (D-14). */
  collapsibleDetails?: string;
}

/** Whether the CPF field should be shown for a given scope. */
function shouldShowCpfField(scope: ConsentScope): boolean {
  return scope === 'PLUGGY_CONNECT_PENDING' || scope.startsWith('PLUGGY_CONNECTOR:');
}

export function ConsentScreen({
  scope,
  onSubmit,
  onConsent,
  onDecline,
  isLoading = false,
  isSubmitting = false,
  hasCpf = false,
  ctaLabel,
  cpfError: serverCpfError,
  cancelHref = '/',
  collapsibleDetails,
}: ConsentScreenProps) {
  const [checked, setChecked] = useState(false);
  const [cpf, setCpf] = useState('');
  const [localCpfError, setLocalCpfError] = useState<string | null>(null);
  const config = getScopeConfig(scope);

  const showCpfField = shouldShowCpfField(scope) && !hasCpf;
  const cpfErrorMessage = localCpfError ?? serverCpfError ?? null;

  // Derive CTA label: explicit prop → scope default → generic default.
  const resolvedCtaLabel =
    ctaLabel ??
    (scope === 'PLUGGY_CONNECT_PENDING' ? 'Concordar e conectar' : 'Concordar e continuar');

  const submitting = isLoading || isSubmitting;

  async function handleSubmit() {
    if (!checked) return;

    // Client-side CPF validation (D-06): must pass before any server call.
    if (showCpfField) {
      const parsed = CPFSchema.safeParse(cpf);
      if (!parsed.success) {
        setLocalCpfError('CPF inválido. Verifique os dígitos e tente novamente.');
        return;
      }
      setLocalCpfError(null);
    }

    // Phase 2 path: onSubmit with CPF.
    if (onSubmit) {
      await onSubmit({
        granted: true,
        cpf: showCpfField ? cpf : undefined,
      });
      return;
    }

    // Phase 1 backward-compat: onConsent only receives the timestamp.
    if (onConsent) {
      onConsent(new Date());
    }
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <h2 className="text-xl font-semibold text-foreground">{config.title}</h2>

      {/* Data points — driven by scope config, NOT hardcoded */}
      <ul className="space-y-1 list-disc list-inside text-sm text-foreground">
        {config.dataPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>

      {/* Inline CPF field — only shown when user has no CPF on file and scope is Pluggy (D-02) */}
      {showCpfField && (
        <div className="space-y-1">
          <label htmlFor="cpf" className="text-sm font-medium text-foreground">
            Seu CPF
          </label>
          <input
            id="cpf"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="000.000.000-00"
            value={cpf}
            onChange={(e) => {
              setCpf(e.target.value);
              // Clear local error when user edits the field.
              if (localCpfError) setLocalCpfError(null);
            }}
            className="w-full h-11 px-3 rounded-md border border-input bg-background text-sm"
          />
          {cpfErrorMessage && (
            <p className="text-xs text-destructive">{cpfErrorMessage}</p>
          )}
        </div>
      )}

      {/* Legal basis */}
      <p className="text-xs text-muted-foreground">
        {config.legalBasis}
        {' — '}
        <a href="/legal/privacy" className="text-primary text-xs hover:underline">
          Política de Privacidade
        </a>
        {' e '}
        <a href="/legal/terms" className="text-primary text-xs hover:underline">
          Termos de Uso
        </a>
      </p>

      {/* Collapsible legal details (D-14) */}
      {collapsibleDetails && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-primary hover:underline">
            {collapsibleDetails}
          </summary>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {/* TODO(plan-02-03): Replace with finalized legal copy from legal team. */}
            <p>
              <strong>LGPD Art. 7º (Consentimento):</strong> O tratamento de dados pessoais
              somente poderá ser realizado com o fornecimento de consentimento pelo titular.
            </p>
            <p>
              <strong>LGPD Art. 8º (Consentimento — requisitos):</strong> O consentimento
              previsto no inciso I do art. 7º desta Lei deverá ser fornecido por escrito ou
              por outro meio que demonstre a manifestação de vontade do titular.
            </p>
            <p>
              <strong>LGPD Art. 9º (Direito de acesso):</strong> O titular tem direito ao
              acesso facilitado às informações sobre o tratamento de seus dados, que deverão
              ser disponibilizadas de forma clara, adequada e ostensiva.
            </p>
            <p>
              Você pode revogar este consentimento a qualquer momento em Configurações
              {'>'} Conexões. A revogação não afeta o tratamento realizado anteriormente.
            </p>
          </div>
        </details>
      )}

      {/* Consent checkbox — styled native checkbox (Radix Checkbox is aria-hidden,
          breaking register() in RHF; plan 01-02 finding D-Radix-Checkbox) */}
      <label className="flex items-start gap-3 cursor-pointer min-h-11">
        <input
          type="checkbox"
          id="consent-checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Label className="font-normal cursor-pointer leading-relaxed">
          Estou ciente e concordo com o tratamento dos meus dados financeiros
          conforme descrito acima e na{' '}
          <a href="/legal/privacy" className="text-primary hover:underline">
            Política de Privacidade
          </a>
          .
        </Label>
      </label>

      {/* Primary CTA */}
      <Button
        type="button"
        variant="default"
        className="w-full"
        disabled={!checked || submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Aguarde...' : resolvedCtaLabel}
      </Button>

      {/* Cancel CTA */}
      {onDecline ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={onDecline}
          disabled={submitting}
        >
          Não conectar agora
        </Button>
      ) : cancelHref ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          asChild
          disabled={submitting}
        >
          <Link href={cancelHref}>Não conectar agora</Link>
        </Button>
      ) : null}
    </div>
  );
}
