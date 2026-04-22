/**
 * UnlockPendingScreen — UI-SPEC § 2.7. Renders the success or
 * expired/invalid variant based on the `result` query parameter.
 */
import Link from 'next/link';
import { MailCheck, MailX } from 'lucide-react';

interface Props {
  result: 'ok' | 'expired';
}

export function UnlockPendingScreen({ result }: Props) {
  if (result === 'ok') {
    return (
      <div className="text-center space-y-4">
        <MailCheck
          className="mx-auto h-12 w-12 text-success"
          aria-hidden="true"
        />
        <h2 className="text-xl font-semibold text-foreground">
          Conta desbloqueada
        </h2>
        <p className="text-sm text-muted-foreground">
          Sua conta foi desbloqueada com sucesso. Você já pode fazer
          login normalmente.
        </p>
        <Link
          href="/login"
          className="inline-block text-sm text-primary hover:underline"
        >
          Fazer login
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center space-y-4">
      <MailX
        className="mx-auto h-12 w-12 text-muted-foreground"
        aria-hidden="true"
      />
      <h2 className="text-xl font-semibold text-foreground">
        Link inválido ou expirado
      </h2>
      <p className="text-sm text-muted-foreground">
        Este link já foi utilizado ou expirou. Se ainda não consegue
        entrar, solicite o desbloqueio na tela de login.
      </p>
      <Link
        href="/login"
        className="inline-block text-sm text-primary hover:underline"
      >
        Voltar para login
      </Link>
    </div>
  );
}
