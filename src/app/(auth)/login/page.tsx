import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <AuthShell
      title="Entrar na sua conta"
      footer={
        <p className="text-sm text-muted-foreground text-center">
          Não tem uma conta?{' '}
          <Link href="/signup" className="text-primary hover:underline">
            Criar conta
          </Link>
        </p>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
