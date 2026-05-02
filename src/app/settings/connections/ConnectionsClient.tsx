'use client';

/**
 * ConnectionsClient — Plan 02-06.
 *
 * Client wrapper for /settings/connections that manages sync + disconnect
 * interactions on behalf of ConnectionCard components.
 *
 * Responsibilities:
 *   - Handle sync button clicks: POST /api/pluggy/items/:id/sync.
 *   - Handle disconnect button clicks: open DisconnectConfirmModal.
 *   - Render DisconnectConfirmModal with DELETE /api/pluggy/items/:id on confirm.
 *   - Show Sonner toasts for success / error states.
 *   - Free-tier sync click renders PaywallStubCard modal instead of calling the API.
 */
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { ConnectionCard, type SubAccount } from '@/components/connections/ConnectionCard';
import { DisconnectConfirmModal } from '@/components/connections/DisconnectConfirmModal';
import { PaywallStubCard } from '@/components/billing/PaywallStubCard';
import { Dialog, DialogContent } from '@/components/ui/dialog';

type ItemStatus = 'UPDATING' | 'LOGIN_ERROR' | 'OUTDATED' | 'WAITING_USER_INPUT' | 'UPDATED';

interface ItemData {
  id: string;
  institution_name: string;
  institution_logo_url: string | null;
  status: ItemStatus;
  last_synced_at: Date | null;
  accounts: SubAccount[];
  cooldown_remaining_seconds: number;
}

interface ConnectionsClientProps {
  items: ItemData[];
  subscription_tier: string;
}

export function ConnectionsClient({ items, subscription_tier }: ConnectionsClientProps) {
  const [disconnect_target, setDisconnectTarget] = useState<ItemData | null>(null);
  const [paywall_open, setPaywallOpen] = useState(false);
  const [is_syncing, setIsSyncing] = useState<Record<string, boolean>>({});
  const [is_disconnecting, setIsDisconnecting] = useState(false);

  const handleSyncClick = useCallback(
    async (item_id: string) => {
      // Free-tier: show paywall modal instead of calling the API (D-29)
      if (subscription_tier === 'free') {
        setPaywallOpen(true);
        return;
      }

      setIsSyncing((prev) => ({ ...prev, [item_id]: true }));
      try {
        const res = await fetch(`/api/pluggy/items/${item_id}/sync`, { method: 'POST' });
        if (res.ok) {
          toast.success('Sincronização iniciada. As atualizações aparecerão em breve.');
        } else {
          const body = await res.json().catch(() => ({})) as Record<string, unknown>;
          if (res.status === 429) {
            const retry_after = (body.retry_after_seconds as number | undefined) ?? 0;
            const mins = Math.ceil(retry_after / 60);
            toast.error(`Aguarde ${mins} minutos para sincronizar novamente.`);
          } else if (res.status === 403) {
            setPaywallOpen(true);
          } else {
            toast.error('Não foi possível sincronizar agora. Tentaremos novamente automaticamente.');
          }
        }
      } catch {
        toast.error('Não foi possível sincronizar agora. Tentaremos novamente automaticamente.');
      } finally {
        setIsSyncing((prev) => ({ ...prev, [item_id]: false }));
      }
    },
    [subscription_tier],
  );

  const handleDisconnectClick = useCallback((item_id: string) => {
    const target = items.find((i) => i.id === item_id) ?? null;
    setDisconnectTarget(target);
  }, [items]);

  const handleDisconnectConfirm = useCallback(async () => {
    if (!disconnect_target) return;
    setIsDisconnecting(true);
    try {
      const res = await fetch(`/api/pluggy/items/${disconnect_target.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Conexão com ${disconnect_target.institution_name} encerrada.`);
        setDisconnectTarget(null);
        // Reload to reflect disconnected state (full SPA navigation is Phase 4)
        window.location.reload();
      } else {
        toast.error('Não foi possível desconectar. Tente novamente ou entre em contato com o suporte.');
      }
    } catch {
      toast.error('Não foi possível desconectar. Tente novamente ou entre em contato com o suporte.');
    } finally {
      setIsDisconnecting(false);
    }
  }, [disconnect_target]);

  return (
    <>
      <div className="space-y-4">
        {items.map((item) => (
          <ConnectionCard
            key={item.id}
            item_id={item.id}
            institution_name={item.institution_name}
            institution_logo_url={item.institution_logo_url}
            status={item.status}
            last_synced_at={item.last_synced_at}
            accounts={item.accounts}
            subscription_tier={subscription_tier}
            cooldown_remaining_seconds={item.cooldown_remaining_seconds}
            onSyncClick={handleSyncClick}
            onDisconnectClick={handleDisconnectClick}
          />
        ))}
      </div>

      {/* DisconnectConfirmModal — requires typed 'DISCONNECT' (UI-SPEC § 3.8, T-02-F) */}
      {disconnect_target && (
        <DisconnectConfirmModal
          open={!!disconnect_target}
          onOpenChange={(o) => { if (!o) setDisconnectTarget(null); }}
          institutionName={disconnect_target.institution_name}
          onConfirm={handleDisconnectConfirm}
          isConfirming={is_disconnecting}
        />
      )}

      {/* Paywall modal for free-tier sync attempts (D-29) */}
      <Dialog open={paywall_open} onOpenChange={setPaywallOpen}>
        <DialogContent className="max-w-sm">
          <PaywallStubCard context="second-item-block" />
        </DialogContent>
      </Dialog>
    </>
  );
}
