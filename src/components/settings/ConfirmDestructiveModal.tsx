'use client';
/**
 * ConfirmDestructiveModal — UI-SPEC § 2.11.
 *
 * Generic reusable Dialog for destructive actions. Requires a noun-qualified
 * `cancelLabel` (e.g., "Cancelar exclusão", "Cancelar exportação") per
 * UI-SPEC — never a generic "Cancelar".
 *
 * Optional `confirmPhrase` enables a type-in field that must exactly match
 * the phrase before the confirm button is enabled (e.g., `'EXCLUIR'` for
 * account deletion). When omitted, the confirm button is always enabled.
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
import { Label } from '@/components/ui/label';

export interface ConfirmDestructiveModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  /** REQUIRED — noun-qualified cancel label per UI-SPEC § 2.11.
   * Example: "Cancelar exclusão", "Cancelar exportação" */
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  confirmVariant?: 'destructive' | 'default';
  /** When provided, the confirm button is disabled until the user types
   * this exact phrase (case-sensitive). Example: 'EXCLUIR' */
  confirmPhrase?: string;
  isLoading?: boolean;
}

export function ConfirmDestructiveModal({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  confirmVariant = 'destructive',
  confirmPhrase,
  isLoading = false,
}: ConfirmDestructiveModalProps) {
  const [typed_phrase, setTypedPhrase] = useState('');

  const can_confirm =
    !isLoading &&
    (confirmPhrase === undefined || typed_phrase === confirmPhrase);

  async function handleConfirm() {
    if (!can_confirm) return;
    await onConfirm();
  }

  function handleClose() {
    setTypedPhrase('');
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>

        {confirmPhrase !== undefined && (
          <div className="space-y-2">
            <Label htmlFor="confirm-phrase-input">
              Digite{' '}
              <code className="bg-muted px-1 rounded text-destructive font-bold">
                {confirmPhrase}
              </code>{' '}
              para confirmar:
            </Label>
            <Input
              id="confirm-phrase-input"
              type="text"
              value={typed_phrase}
              onChange={(e) => setTypedPhrase(e.target.value)}
              placeholder={confirmPhrase}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
            type="button"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={!can_confirm}
            type="button"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
