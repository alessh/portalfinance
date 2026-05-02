'use client';

/**
 * DisconnectConfirmModal — Plan 02-06, UI-SPEC § 3.8.
 *
 * 2-step typed-confirmation dialog for disconnecting a bank connection.
 * User must type 'DISCONNECT' verbatim before the confirm button enables (T-02-F).
 *
 * Cancel label is 'Manter conexão' (NOT 'Cancelar') per UI-SPEC § 3.8.
 * aria-disabled is set alongside HTML disabled for screen reader compatibility.
 */
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

export interface DisconnectConfirmModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  institutionName: string;
  onConfirm: () => Promise<void>;
  isConfirming?: boolean;
}

/** Verbatim phrase required before confirm button enables (T-02-F, UI-SPEC § 3.8). */
const PHRASE = 'DISCONNECT';

export function DisconnectConfirmModal({
  open,
  onOpenChange,
  institutionName,
  onConfirm,
  isConfirming = false,
}: DisconnectConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const [confirming_internal, setConfirmingInternal] = useState(false);

  const confirming = isConfirming || confirming_internal;
  const enabled = typed === PHRASE && !confirming;

  // Reset typed phrase whenever the modal closes
  const handleOpenChange = (next_open: boolean) => {
    if (!next_open) setTyped('');
    onOpenChange(next_open);
  };

  const handleConfirm = async () => {
    if (!enabled) return;
    setConfirmingInternal(true);
    try {
      await onConfirm();
    } finally {
      setConfirmingInternal(false);
      setTyped('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Desconectar ${institutionName}?`}</DialogTitle>
          <DialogDescription>
            Ao desconectar: (a) a sincronização será interrompida imediatamente; (b) seu
            histórico de transações será mantido; (c) para sincronizar novamente, será
            necessário uma nova conexão e consentimento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Para confirmar, digite <span className="font-mono font-semibold">DISCONNECT</span>:
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Digite DISCONNECT para confirmar"
            aria-label="Campo de confirmação — digite DISCONNECT"
            aria-required="true"
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={confirming}>
            Manter conexão
          </Button>
          <Button
            variant="destructive"
            disabled={!enabled}
            aria-disabled={!enabled}
            onClick={() => void handleConfirm()}
          >
            {confirming ? (
              <>
                <Loader2 className="animate-spin h-4 w-4 mr-2" />
                Desconectando...
              </>
            ) : (
              'Desconectar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
