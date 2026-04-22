import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { SignupForm } from '@/components/auth/SignupForm';

export default function SignupPage() {
  return (
    <AuthShell
      title="Crie sua conta"
      description="Acompanhe suas finanças com clareza."
      footer={
        <p className="text-sm text-muted-foreground text-center">
          Já tem uma conta?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Entrar
          </Link>
        </p>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
