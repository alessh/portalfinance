import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordResetRequestForm } from '@/components/auth/PasswordResetRequestForm';

export default function ResetRequestPage() {
  return (
    <AuthShell
      title="Recuperar acesso"
      description="Digite o e-mail cadastrado para receber um link de recuperação."
      footer={
        <p className="text-sm text-muted-foreground text-center">
          <Link href="/login" className="text-primary hover:underline">
            Voltar para login
          </Link>
        </p>
      }
    >
      <PasswordResetRequestForm />
    </AuthShell>
  );
}
