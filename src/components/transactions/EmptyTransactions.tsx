/**
 * EmptyTransactions — Plan 02-06, UI-SPEC § 3.6.
 *
 * Three distinct empty-state components for the /transactions page:
 *   - EmptyNoItems: user has no bank connections yet
 *   - EmptySyncing: user has connections but sync is still in progress
 *   - EmptyNoTransactionsInMonth: sync complete but 0 transactions in selected month
 *
 * All three are plain server-compatible components (no 'use client' needed).
 */
import Link from 'next/link';
import { Landmark, Loader2, CalendarOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * EmptyNoItems — shown when user has no pluggy_items at all.
 * CTA: "Conectar meu banco" → /connect
 */
export function EmptyNoItems() {
  return (
    <div className="text-center py-16">
      <Landmark
        className="mx-auto h-10 w-10 text-muted-foreground"
        aria-hidden="true"
      />
      <h2 className="mt-6 text-lg font-semibold text-foreground">
        Nenhuma conta conectada
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Conecte seu primeiro banco para visualizar suas transações aqui.
      </p>
      <Button asChild className="mt-6">
        <Link href="/connect">Conectar meu banco</Link>
      </Button>
    </div>
  );
}

/**
 * EmptySyncing — shown when items exist but are still in UPDATING status.
 * Functional spinner (Loader2 with animate-spin). CTA: "Voltar para o início"
 */
export function EmptySyncing() {
  return (
    <div className="text-center py-16">
      <Loader2
        className="mx-auto h-10 w-10 text-muted-foreground animate-spin"
        aria-hidden="true"
      />
      <h2 className="mt-6 text-lg font-semibold text-foreground">
        Buscando suas transações...
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Isso pode levar alguns minutos. A página se atualizará automaticamente.
      </p>
      <Button asChild variant="ghost" className="mt-6">
        <Link href="/">Voltar para o início</Link>
      </Button>
    </div>
  );
}

/**
 * EmptyNoTransactionsInMonth — shown when sync is complete but 0 rows in the selected month.
 */
export function EmptyNoTransactionsInMonth({ month_label }: { month_label: string }) {
  return (
    <div className="text-center py-16">
      <CalendarOff
        className="mx-auto h-10 w-10 text-muted-foreground"
        aria-hidden="true"
      />
      <h2 className="mt-6 text-lg font-semibold text-foreground">
        {`Sem transações em ${month_label}`}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Nenhuma transação foi registrada neste período.
      </p>
    </div>
  );
}
