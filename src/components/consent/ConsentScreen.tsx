'use client';
/**
 * ConsentScreen — UI-SPEC § 2.8.
 *
 * Reusable consent gate for ACCOUNT_CREATION (Phase 1, exercised by unit
 * tests; SignupForm keeps its own inline checkbox per § 2.2) and for
 * PLUGGY_CONNECTOR:<id> (Phase 2 first production consumer, shown as a
 * modal overlay during Pluggy Connect flow).
 *
 * **Phase 1 note:** This component is NOT the production signup form.
 * SignupForm (§ 2.2) uses an inline consent checkbox directly. ConsentScreen
 * is built and unit-tested now so Phase 2 can import it without
 * modification. See UI-SPEC § 2.8: "Renders inside AuthShell (Phase 1) or
 * a modal overlay (Phase 2 Pluggy Connect flow)."
 *
 * **Data flow:** scope config comes entirely from getScopeConfig() —
 * no hardcoded JSX for data points, so PLUGGY_CONNECTOR:* variants are
 * driven by consentScopes.ts without touching this file.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { type ConsentScope, getScopeConfig } from '@/lib/consentScopes';

export interface ConsentScreenProps {
  scope: ConsentScope;
  onConsent: (consentedAt: Date) => void;
  onDecline?: () => void;
  isLoading?: boolean;
}

export function ConsentScreen({
  scope,
  onConsent,
  onDecline,
  isLoading = false,
}: ConsentScreenProps) {
  const [checked, setChecked] = useState(false);
  const config = getScopeConfig(scope);

  function handleConsent() {
    if (!checked) return;
    onConsent(new Date());
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
          Estou ciente e concordo com o tratamento dos meus dados pessoais
          conforme descrito acima.
        </Label>
      </label>

      {/* CTA */}
      <Button
        type="button"
        variant="default"
        className="w-full"
        disabled={!checked || isLoading}
        onClick={handleConsent}
      >
        Concordar e continuar
      </Button>

      {/* Decline (optional) */}
      {onDecline ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={onDecline}
          disabled={isLoading}
        >
          Não autorizar
        </Button>
      ) : null}
    </div>
  );
}
