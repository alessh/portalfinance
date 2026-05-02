'use client';
/**
 * ConnectIsland — client island for /connect page.
 *
 * Handles the consent submit → token fetch → widget render → item persist sequence.
 * The server component (page.tsx) determines paywall vs connect branch and injects
 * session-derived props. This island owns no server state.
 *
 * Flow:
 *   1. User submits ConsentScreen (CPF + checkbox).
 *   2. POST /api/connect/init → { connect_token }.
 *   3. PluggyConnectWidget opens with token.
 *   4. On widget onSuccess → POST /api/pluggy/items → redirect /connect/success.
 *   5. On widget onClose/onError → reset state, show toast.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ConsentScreen } from '@/components/consent/ConsentScreen';
import { PluggyConnectWidget } from '@/components/connect/PluggyConnectWidget';
import type { ConsentScope } from '@/lib/consentScopes';

export interface ConnectIslandProps {
  scope: ConsentScope;
  hasCpf: boolean;
  reconnectItemId?: string;
}

export function ConnectIsland({ scope, hasCpf, reconnectItemId }: ConnectIslandProps) {
  const router = useRouter();
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cpfError, setCpfError] = useState<string | null>(null);

  async function handleConsentSubmit(data: { granted: boolean; cpf?: string }) {
    setIsSubmitting(true);
    setCpfError(null);
    try {
      const res = await fetch('/api/connect/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: data.cpf,
          granted: true,
          reconnect_item_id: reconnectItemId,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === 'INVALID_CPF' || body.error === 'CPF_REQUIRED') {
          setCpfError('CPF inválido. Verifique os dígitos e tente novamente.');
          return;
        }
        toast.error('Algo deu errado. Tente novamente em instantes.');
        return;
      }

      const { connect_token } = (await res.json()) as { connect_token: string };
      setConnectToken(connect_token);
    } catch {
      toast.error('Algo deu errado. Tente novamente em instantes.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleWidgetSuccess(pluggy_item_id: string, connector_id: number) {
    try {
      const res = await fetch('/api/pluggy/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pluggy_item_id,
          connector_id: String(connector_id),
          // connector name not available from widget callback — use connector_id as name stub.
          // The sync worker will update institution_name from the item response.
          institution_name: `Conta ${connector_id}`,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === 'ALREADY_CONNECTED') {
          toast.info('Esta conta já está conectada.');
        } else {
          toast.error('Não foi possível conectar. Tente novamente ou entre em contato com o suporte.');
        }
        setConnectToken(null);
        return;
      }

      router.push('/connect/success');
    } catch {
      toast.error('Não foi possível conectar. Tente novamente ou entre em contato com o suporte.');
      setConnectToken(null);
    }
  }

  function handleWidgetError(err: { message: string }) {
    console.error('[PluggyConnect] widget error:', err.message);
    toast.error('Não foi possível conectar. Tente novamente ou entre em contato com o suporte.');
    setConnectToken(null);
  }

  function handleWidgetClose() {
    toast.info('Conexão cancelada. Tente novamente quando estiver pronto.');
    setConnectToken(null);
  }

  // Show widget overlay when token is ready.
  if (connectToken) {
    return (
      <PluggyConnectWidget
        connectToken={connectToken}
        reconnectItemId={reconnectItemId}
        onSuccess={handleWidgetSuccess}
        onError={handleWidgetError}
        onClose={handleWidgetClose}
      />
    );
  }

  const ctaLabel =
    scope === 'PLUGGY_CONNECT_PENDING'
      ? 'Concordar e conectar'
      : reconnectItemId
        ? 'Reconectar'
        : 'Concordar e conectar';

  return (
    <ConsentScreen
      scope={scope}
      hasCpf={hasCpf}
      ctaLabel={ctaLabel}
      cpfError={cpfError}
      cancelHref="/"
      collapsibleDetails={scope === 'PLUGGY_CONNECT_PENDING' ? 'Detalhes legais' : undefined}
      isSubmitting={isSubmitting}
      onSubmit={handleConsentSubmit}
    />
  );
}
