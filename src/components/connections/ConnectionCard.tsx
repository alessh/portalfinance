'use client';

/**
 * ConnectionCard — Plan 02-06, UI-SPEC § 3.7, D-17, D-18, D-20, D-21, D-25, D-28.
 *
 * Displays one Pluggy item (bank connection) with:
 *   - Institution logo + name + status pill
 *   - Last-synced relative time with shadcn Tooltip showing absolute timestamp
 *   - Collapsible sub-account list with balance
 *   - Cooldown-aware sync button (live countdown via setInterval)
 *   - Disconnect button (opens confirm modal via onDisconnectClick)
 *
 * Status pill colors (UI-SPEC § Color):
 *   UPDATED → emerald | UPDATING → blue (pulsing dot) | LOGIN_ERROR → red | OUTDATED/WAITING → amber
 *
 * Tooltip copy (UI-SPEC § 3.7):
 *   "A Pluggy permite uma sincronização manual a cada 30 minutos para evitar sobrecarga."
 */
import { useState, useEffect, useCallback } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type ItemStatus = 'UPDATING' | 'LOGIN_ERROR' | 'OUTDATED' | 'WAITING_USER_INPUT' | 'UPDATED';

export interface SubAccount {
  id: string;
  name: string;
  balance: string;
  currency: string;
  type: string;
  credit_limit: string | null;
}

export interface ConnectionCardProps {
  item_id: string;
  institution_name: string;
  institution_logo_url: string | null;
  status: ItemStatus;
  last_synced_at: Date | null;
  accounts: SubAccount[];
  subscription_tier: string;
  cooldown_remaining_seconds: number;
  onSyncClick: (item_id: string) => void;
  onDisconnectClick: (item_id: string) => void;
}

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtBalance(amount: string): string {
  return fmtBRL.format(Number(amount));
}

function statusPillClasses(status: ItemStatus): string {
  switch (status) {
    case 'UPDATED':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
    case 'UPDATING':
      return ''; // rendered as pulsing dot, not pill
    case 'LOGIN_ERROR':
      return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
    case 'OUTDATED':
    case 'WAITING_USER_INPUT':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
  }
}

function statusLabel(status: ItemStatus): string {
  switch (status) {
    case 'UPDATED':
      return 'Atualizado';
    case 'UPDATING':
      return 'Atualizando';
    case 'LOGIN_ERROR':
      return 'Erro de login';
    case 'OUTDATED':
      return 'Desatualizado';
    case 'WAITING_USER_INPUT':
      return 'Aguardando ação';
  }
}

function isBroken(status: ItemStatus): boolean {
  return status === 'LOGIN_ERROR' || status === 'WAITING_USER_INPUT';
}

export function ConnectionCard({
  item_id,
  institution_name,
  institution_logo_url,
  status,
  last_synced_at,
  accounts,
  subscription_tier,
  cooldown_remaining_seconds,
  onSyncClick,
  onDisconnectClick,
}: ConnectionCardProps) {
  const [accounts_open, setAccountsOpen] = useState(false);
  // Live cooldown countdown — tick every 60s (D-28 UX)
  const [cooldown_secs, setCooldownSecs] = useState(cooldown_remaining_seconds);

  useEffect(() => {
    if (cooldown_secs <= 0) return;
    const interval = setInterval(() => {
      setCooldownSecs((prev) => Math.max(0, prev - 60));
    }, 60_000);
    return () => clearInterval(interval);
  }, [cooldown_secs]);

  const handleSyncClick = useCallback(() => {
    onSyncClick(item_id);
  }, [item_id, onSyncClick]);

  const handleDisconnectClick = useCallback(() => {
    onDisconnectClick(item_id);
  }, [item_id, onDisconnectClick]);

  const cooldown_mins = Math.ceil(cooldown_secs / 60);
  const is_cooling = cooldown_secs > 0;
  const broken = isBroken(status);

  // Sync button label + enabled state
  let sync_label: string;
  let sync_disabled = false;
  if (broken) {
    sync_label = 'Reconectar';
  } else if (is_cooling) {
    sync_label = `Aguarde ${cooldown_mins} min`;
    sync_disabled = true;
  } else {
    sync_label = 'Sincronizar agora';
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {/* Institution logo or fallback initials */}
          {institution_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={institution_logo_url}
              alt={`Logo ${institution_name}`}
              className="h-10 w-10 rounded-md object-contain flex-shrink-0 bg-muted"
            />
          ) : (
            <div
              className="h-10 w-10 rounded-md flex items-center justify-center bg-muted text-muted-foreground text-sm font-semibold flex-shrink-0"
              aria-hidden="true"
            >
              {institution_name.slice(0, 2).toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {institution_name}
              </h3>

              {/* Status pill (or pulsing dot for UPDATING) */}
              {status === 'UPDATING' ? (
                <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                  <span
                    className="h-2 w-2 rounded-full bg-blue-500 motion-safe:animate-pulse"
                    aria-hidden="true"
                  />
                  {statusLabel(status)}
                </span>
              ) : (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusPillClasses(status)}`}
                >
                  {statusLabel(status)}
                </span>
              )}
            </div>

            {/* Last-synced relative time with tooltip */}
            {last_synced_at && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-xs text-muted-foreground mt-0.5 cursor-default">
                      {`Sincronizado ${formatDistanceToNow(last_synced_at, {
                        addSuffix: true,
                        locale: ptBR,
                      })}`}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {format(last_synced_at, "d MMM yyyy HH:mm 'BRT'", { locale: ptBR })}
                    </p>
                    {is_cooling && (
                      <p className="mt-1">
                        A Pluggy permite uma sincronização manual a cada 30 minutos para evitar
                        sobrecarga.
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Sub-accounts collapsible (D-20) */}
        {accounts.length > 0 && (
          <Collapsible open={accounts_open} onOpenChange={setAccountsOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {accounts_open ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {accounts_open
                ? 'Ocultar contas'
                : `Ver ${accounts.length} ${accounts.length === 1 ? 'conta' : 'contas'}`}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <ul className="space-y-1">
                {accounts.map((acc) => (
                  <li
                    key={acc.id}
                    className="flex items-center justify-between text-sm py-1 px-2 rounded-md bg-muted/50"
                  >
                    <span className="text-foreground truncate max-w-[60%]">{acc.name}</span>
                    <span className="text-muted-foreground tabular-nums text-xs">
                      {`Saldo: ${fmtBalance(acc.balance)}`}
                      {acc.credit_limit && (
                        <span className="ml-1 text-muted-foreground/70">
                          {`/ Limite: ${fmtBalance(acc.credit_limit)}`}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sync / Reconnect button */}
          {broken ? (
            <Button
              variant="default"
              size="sm"
              className="text-sm"
              onClick={handleSyncClick}
            >
              {sync_label}
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-sm"
                      disabled={sync_disabled}
                      onClick={handleSyncClick}
                    >
                      {sync_label}
                    </Button>
                  </span>
                </TooltipTrigger>
                {is_cooling && (
                  <TooltipContent>
                    A Pluggy permite uma sincronização manual a cada 30 minutos para evitar
                    sobrecarga.
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Disconnect button — always visible (UI-SPEC § Action button states) */}
          <Button
            variant="outline"
            size="sm"
            className="text-sm border-destructive text-destructive hover:bg-destructive/10"
            onClick={handleDisconnectClick}
          >
            Desconectar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
