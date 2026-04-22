import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordResetConfirmForm } from '@/components/auth/PasswordResetConfirmForm';

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetConfirmPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = params.token ?? '';
  return (
    <AuthShell title="Criar nova senha">
      {token ? (
        <PasswordResetConfirmForm token={token} />
      ) : (
        <p className="text-sm text-destructive">
          Link inválido. Solicite um novo na tela de login.
        </p>
      )}
    </AuthShell>
  );
}
