/**
 * PaywallStubCard — reusable upgrade prompt card.
 *
 * UI-SPEC § 3.9 / CONTEXT.md D-27 (transactions history), D-49 (2nd item block).
 *
 * Used in two contexts:
 *   - 'transactions-history': overlays older month transactions for free-tier users.
 *   - 'second-item-block': replaces /connect page for free-tier users with 1 active item.
 *
 * Phase 5 wires the real subscription page at /settings/billing. Phase 2 ships
 * this as a stub linking to that future route (D-27, D-29, D-49).
 */
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface PaywallStubCardProps {
  context: 'transactions-history' | 'second-item-block';
}

export function PaywallStubCard({ context }: PaywallStubCardProps) {
  const config =
    context === 'transactions-history'
      ? {
          title: 'Histórico completo disponível no plano pago',
          body: 'Assine o plano pago para acessar todo o histórico de transações.',
          primaryHref: '/settings/billing',
          primaryLabel: 'Ver planos',
          secondaryHref: undefined as string | undefined,
          secondaryLabel: undefined as string | undefined,
        }
      : {
          title: 'Plano gratuito limitado',
          body: 'Conexões adicionais e sincronização manual estão disponíveis no plano pago. Cancele quando quiser.',
          primaryHref: '/settings/billing',
          primaryLabel: 'Ver planos',
          secondaryHref: '/',
          secondaryLabel: 'Voltar para o dashboard',
        };

  return (
    <div className="max-w-sm mx-auto text-center py-16">
      <Lock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-6 text-lg font-semibold text-foreground">{config.title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{config.body}</p>
      <Button asChild className="mt-6">
        <Link href={config.primaryHref}>{config.primaryLabel}</Link>
      </Button>
      {config.secondaryHref && (
        <div>
          <Button asChild variant="ghost" className="mt-2">
            <Link href={config.secondaryHref}>{config.secondaryLabel}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
