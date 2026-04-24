/**
 * AccountLockedScreen — UI-SPEC § 2.6.
 */
import { ShieldAlert } from 'lucide-react';

export function AccountLockedScreen() {
  return (
    <div className="text-center space-y-4">
      <ShieldAlert
        className="mx-auto h-12 w-12 text-warning"
        aria-hidden="true"
      />
      <h2 className="text-xl font-semibold text-foreground">
        Conta temporariamente bloqueada
      </h2>
      <p className="text-sm text-muted-foreground">
        Por segurança, bloqueamos o acesso após múltiplas tentativas
        incorretas. Você receberá um e-mail com um link para desbloquear
        a conta, ou aguarde 15 minutos.
      </p>
      <a
        href="mailto:suporte@portalfinance.app"
        className="inline-block text-sm text-primary hover:underline"
      >
        Entrar em contato
      </a>
    </div>
  );
}
