'use client';

/**
 * Email Verification Nag Banner — UI-SPEC § 2.9.
 *
 * Plan 01-04 — D-02 (email verification deferred + persistent nag banner).
 *
 * State machine (UI-SPEC § 2.9):
 *   1. Default: banner visible
 *   2. After "Verificar agora" click: CTA replaced with "E-mail enviado ✓" for 3 seconds
 *   3. After dismiss (X) button: sets sessionStorage → unmounts
 *   4. After email verified (server confirms): component not rendered at all
 *
 * The "Verificar agora" CTA calls /api/auth/email/resend (stub → 501 in Phase 1).
 * The optimistic toast fires regardless of server response (UX expectation).
 *
 * This component is NOT rendered when emailVerified=true (parent server
 * component guards this via database query).
 */
import { useState, useEffect, useCallback } from 'react';
import { MailWarning, X } from 'lucide-react';
import { toast } from 'sonner';

const DISMISSED_KEY = 'nag_email_dismissed';

interface EmailVerificationNagBannerProps {
  emailVerified: boolean;
}

export function EmailVerificationNagBanner({ emailVerified }: EmailVerificationNagBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [sent, setSent] = useState(false);

  // Read sessionStorage on mount — component self-hides if previously dismissed.
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(DISMISSED_KEY) === '1') {
      setDismissed(true);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }, []);

  const handleResend = useCallback(async () => {
    // Optimistic UX: show toast immediately even before server responds.
    // The /api/auth/email/resend endpoint is a stub returning 501 in Phase 1.
    // Phase 2 wires the real email verification flow.
    setSent(true);
    toast.success('E-mail de verificação reenviado.');
    setTimeout(() => setSent(false), 3000);

    await fetch('/api/auth/email/resend', { method: 'POST' }).catch(() => {
      // Silently ignore Phase 1 stub errors — the UX toast is optimistic.
    });
  }, []);

  if (emailVerified || dismissed) {
    return null;
  }

  return (
    /*
     * UI-SPEC § 2.9: sticky top, z-40, h-12 (48px).
     * Renders as <aside> with aria-label for screen reader landmark (Accessibility).
     * Do NOT use position:fixed — it overlays the auth card on the demo dashboard.
     */
    <aside
      aria-label="Verificação de e-mail pendente"
      className="sticky top-0 z-40 flex items-center gap-3 h-12 px-4 bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800"
    >
      <MailWarning size={16} className="text-blue-600 dark:text-blue-400 flex-shrink-0" aria-hidden="true" />

      <p className="flex-1 text-sm text-foreground">
        Confirme seu e-mail para garantir acesso contínuo à conta.
      </p>

      {/* Resend CTA */}
      {sent ? (
        <span className="text-sm text-green-700 dark:text-green-400 font-semibold whitespace-nowrap">
          E-mail enviado ✓
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void handleResend()}
          className="text-sm text-primary font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary whitespace-nowrap"
        >
          Verificar agora
        </button>
      )}

      {/* Dismiss button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary min-w-8 min-h-8 flex items-center justify-center"
        aria-label="Dispensar aviso de verificação de e-mail"
      >
        <X size={16} />
      </button>
    </aside>
  );
}
