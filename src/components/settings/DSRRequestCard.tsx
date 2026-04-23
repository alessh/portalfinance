'use client';
/**
 * DSRRequestCard — UI-SPEC § 2.11.
 *
 * Renders the export and delete CTAs inside /settings/privacy. Each CTA
 * opens a ConfirmDestructiveModal before POSTing to the respective route.
 *
 * After a successful request:
 *   - Shows RequestPendingState with the protocol ID
 *   - Disables the CTA for that request type
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConfirmDestructiveModal } from './ConfirmDestructiveModal';
import { RequestPendingState } from './RequestPendingState';

export function DSRRequestCard() {
  const [export_modal_open, setExportModalOpen] = useState(false);
  const [delete_modal_open, setDeleteModalOpen] = useState(false);
  const [export_protocol, setExportProtocol] = useState<string | null>(null);
  const [delete_protocol, setDeleteProtocol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<'export' | 'delete' | null>(null);

  async function submitExport() {
    setLoading('export');
    setError(null);
    try {
      const res = await fetch('/api/privacy/export', { method: 'POST' });
      const json = (await res.json()) as { protocol?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Erro ao processar solicitação.');
      setExportProtocol(json.protocol ?? null);
      setExportModalOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function submitDelete(turnstile_token: string) {
    // TODO(phase2): replace dummy token with real @marsidev/react-turnstile widget token.
    // In production, passing a dummy token causes 400 from POST /api/privacy/delete.
    // Guard here to surface the misconfiguration immediately rather than silently failing.
    if (process.env.NODE_ENV === 'production' && turnstile_token.startsWith('dummy-')) {
      setError('Verificação anti-bot não configurada. Contate o suporte.');
      return;
    }
    setLoading('delete');
    setError(null);
    try {
      const res = await fetch('/api/privacy/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm_phrase: 'EXCLUIR', turnstile_token }),
      });
      const json = (await res.json()) as { protocol?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Erro ao processar solicitação.');
      setDeleteProtocol(json.protocol ?? null);
      setDeleteModalOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Export section */}
      {export_protocol ? (
        <RequestPendingState
          dsr_request_id={export_protocol}
          request_type="EXPORT"
        />
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Exportar meus dados</h3>
          <p className="text-sm text-muted-foreground">
            Receba uma cópia de todos os seus dados armazenados no Portal Finance
            em formato estruturado (LGPD Art. 18, III).
          </p>
          <Button
            variant="outline"
            onClick={() => setExportModalOpen(true)}
            disabled={loading !== null}
          >
            Exportar meus dados
          </Button>
        </div>
      )}

      {/* Delete section */}
      {delete_protocol ? (
        <RequestPendingState
          dsr_request_id={delete_protocol}
          request_type="DELETE"
        />
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-destructive">Excluir minha conta</h3>
          <p className="text-sm text-muted-foreground">
            Solicita a exclusão permanente da sua conta e de todos os dados
            associados (LGPD Art. 18, VI). Esta ação não pode ser desfeita.
          </p>
          <Button
            variant="destructive"
            onClick={() => setDeleteModalOpen(true)}
            disabled={loading !== null}
          >
            Excluir minha conta
          </Button>
        </div>
      )}

      {/* Export confirmation modal */}
      <ConfirmDestructiveModal
        open={export_modal_open}
        onClose={() => setExportModalOpen(false)}
        title="Exportar meus dados"
        body="Uma cópia dos seus dados será preparada e enviada por e-mail em até 15 dias (LGPD Art. 19)."
        confirmLabel="Solicitar exportação"
        cancelLabel="Cancelar exportação"
        confirmVariant="default"
        onConfirm={submitExport}
        isLoading={loading === 'export'}
      />

      {/* Delete confirmation modal — requires typing 'EXCLUIR' */}
      <ConfirmDestructiveModal
        open={delete_modal_open}
        onClose={() => setDeleteModalOpen(false)}
        title="Excluir minha conta"
        body="Esta ação é permanente. Todos os seus dados e conexões bancárias serão removidos em até 30 dias. Para confirmar, digite EXCLUIR abaixo."
        confirmLabel="Excluir minha conta"
        cancelLabel="Cancelar exclusão"
        confirmVariant="destructive"
        confirmPhrase="EXCLUIR"
        onConfirm={() => {
          // TODO(phase2): wire real Turnstile widget token here (Phase 1 scaffolding only).
          void submitDelete('dummy-turnstile-token-for-phase1');
        }}
        isLoading={loading === 'delete'}
      />
    </div>
  );
}
