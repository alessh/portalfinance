'use client';

/**
 * TransactionList — Plan 02-06, UI-SPEC § 3.5.
 *
 * Date-grouped transaction list with sticky headers and semantic chips.
 * Designed for server-driven pagination via "Carregar mais" button.
 *
 * Design decisions:
 *   - Date headers: 'Hoje' / 'Ontem' / '{d MMM}' (ptBR) — D-15
 *   - Amount: tabular-nums, CREDIT=emerald-700, DEBIT=foreground — D-23
 *   - Chips: Pendente (amber), Transferência (muted), Pagamento de fatura (muted) — D-23, D-31
 *   - Account dot: deterministic hue from hashColor() for visual grouping
 *   - Pending rows dimmed to 60% opacity
 */
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export interface TransactionRow {
  id: string;
  description: string;
  amount: string; // Decimal as string from Drizzle numeric
  type: 'DEBIT' | 'CREDIT';
  posted_at: Date;
  status: 'PENDING' | 'POSTED';
  is_transfer: boolean;
  is_credit_card_payment: boolean;
  account_name: string;
}

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function dateGroupLabel(d: Date): string {
  if (isToday(d)) return 'Hoje';
  if (isYesterday(d)) return 'Ontem';
  return format(d, 'd MMM', { locale: ptBR });
}

/** Deterministic muted color dot from account name — visual account grouping. */
function hashColor(name: string): string {
  const colors = [
    'bg-slate-400',
    'bg-violet-400',
    'bg-orange-400',
    'bg-sky-400',
    'bg-pink-400',
    'bg-lime-400',
  ];
  let h = 0;
  for (const c of name) h = ((h * 31 + c.charCodeAt(0)) | 0);
  return colors[Math.abs(h) % colors.length];
}

export function TransactionList({
  transactions,
  hasMore,
  onLoadMore,
  isLoadingMore,
}: {
  transactions: TransactionRow[];
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
}) {
  // Group by calendar day
  const groups = new Map<string, TransactionRow[]>();
  for (const t of transactions) {
    const key = format(t.posted_at, 'yyyy-MM-dd');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return (
    <ul className="space-y-0 divide-y divide-border">
      {[...groups.entries()].map(([key, rows]) => (
        <li key={key}>
          {/* Sticky date header — h-8 (32px), offset by --sticky-offset CSS var (TopNav + banner) */}
          <h2
            className="sticky h-8 px-4 bg-muted text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center"
            style={{ top: 'var(--sticky-offset, 110px)' }}
          >
            {dateGroupLabel(rows[0].posted_at)}
          </h2>
          <ul>
            {rows.map((t) => {
              const sign = t.type === 'CREDIT' ? '+' : '-';
              const amount_label = `${sign}${fmtBRL.format(Math.abs(Number(t.amount)))}`;
              const amt_color =
                t.type === 'CREDIT'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-foreground';
              const dim_class = t.status === 'PENDING' ? 'opacity-60' : '';
              return (
                <li
                  key={t.id}
                  className={`flex items-start gap-3 min-h-[56px] px-4 py-3 ${dim_class}`}
                >
                  {/* Account color dot */}
                  <span
                    className={`h-2 w-2 rounded-full flex-shrink-0 ${hashColor(t.account_name)} mt-2`}
                    aria-hidden="true"
                  />
                  {/* Description + chips */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{t.description}</p>
                    <p className="text-xs text-muted-foreground flex items-center flex-wrap gap-1 mt-0.5">
                      <span>{t.account_name}</span>
                      {t.status === 'PENDING' && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-sm bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 font-medium"
                          aria-label="Pendente"
                        >
                          Pendente
                        </span>
                      )}
                      {t.is_transfer && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-sm bg-muted text-muted-foreground font-medium"
                          aria-label="Transferência"
                        >
                          Transferência
                        </span>
                      )}
                      {t.is_credit_card_payment && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-sm bg-muted text-muted-foreground font-medium"
                          aria-label="Pagamento de fatura"
                        >
                          Pagamento de fatura
                        </span>
                      )}
                    </p>
                  </div>
                  {/* Amount — tabular-nums for alignment */}
                  <span
                    className={`text-sm font-semibold tabular-nums flex-shrink-0 ${amt_color}`}
                    aria-label={`Valor: ${amount_label} ${t.type === 'CREDIT' ? 'crédito' : 'débito'}`}
                  >
                    {amount_label}
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}

      {/* Load-more pagination (D-22) */}
      {hasMore && (
        <li className="text-center py-6">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="min-w-[200px]"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="animate-spin h-4 w-4 mr-2" />
                Carregando...
              </>
            ) : (
              'Carregar mais'
            )}
          </Button>
        </li>
      )}
    </ul>
  );
}
