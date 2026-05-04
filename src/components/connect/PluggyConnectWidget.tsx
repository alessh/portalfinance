'use client';
/**
 * PluggyConnectWidget — thin wrapper around react-pluggy-connect@2.12.
 *
 * UI-SPEC § 3.3 / CONTEXT.md D-11, D-39.
 *
 * Design rules:
 * - All MFA stays inside the Pluggy iframe — we never POST MFA tokens directly (D-11).
 * - Full-screen overlay rendered by US; the iframe itself is rendered by Pluggy (D-39).
 * - Loading state shown when connectToken is empty (token is fetched async after consent).
 * - NEXT_PUBLIC_PLUGGY_ENV controls sandbox/production mode — must be set in env:
 *   NEXT_PUBLIC_PLUGGY_ENV=sandbox (development/staging) or =production.
 * - peerDependency warning for `pluggy-js` is benign — do NOT install `pluggy-js` (Pitfall 2).
 */
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// react-pluggy-connect references `window` at module-eval time, so importing it
// during SSR throws. Dynamic import with `ssr: false` defers loading to the
// browser; the loading spinner mirrors the empty-token state below for visual
// continuity. Allowed here because this file is a client component.
const PluggyConnect = dynamic(
  () => import('react-pluggy-connect').then((m) => m.PluggyConnect),
  {
    ssr: false,
    loading: () => (
      <div
        aria-label="Carregando widget de conexão bancária"
        role="status"
        className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center"
      >
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    ),
  },
);

export interface PluggyConnectWidgetProps {
  connectToken: string;
  /** Internal UUID for analytics attribution — Pluggy update mode is encoded in the connectToken itself. */
  reconnectItemId?: string;
  onSuccess: (pluggy_item_id: string, connector_id: number) => void;
  onError: (err: { message: string }) => void;
  onClose: () => void;
}

export function PluggyConnectWidget(props: PluggyConnectWidgetProps) {
  if (!props.connectToken) {
    return (
      <div
        aria-label="Carregando widget de conexão bancária"
        role="status"
        className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center"
      >
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm">
      <PluggyConnect
        connectToken={props.connectToken}
        includeSandbox={process.env.NEXT_PUBLIC_PLUGGY_ENV === 'sandbox'}
        onSuccess={(data) => props.onSuccess(data.item.id, data.item.connector.id)}
        onError={(err) => props.onError(err)}
        onClose={() => props.onClose()}
      />
    </div>
  );
}
