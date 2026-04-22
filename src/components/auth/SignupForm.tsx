'use client';
/**
 * SignupForm — UI-SPEC § 2.2.
 *
 * Email + password + confirm + LGPD consent checkbox + ToU/PP links.
 * Submits to /api/auth/signup; on 201, calls Auth.js signIn() and
 * redirects to /dashboard.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PasswordField } from './PasswordField';

interface SignupFormValues {
  email: string;
  password: string;
  confirmPassword: string;
  consent: boolean;
}

export function SignupForm() {
  const router = useRouter();
  const [server_error, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormValues>({
    defaultValues: { consent: false },
  });

  async function onSubmit(values: SignupFormValues) {
    setServerError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setServerError(json.error ?? 'Algo deu errado. Tente novamente.');
        return;
      }
      // The signup route sets the session cookie itself — just navigate.
      router.push('/dashboard');
    } catch {
      setServerError('Sem conexão. Verifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {server_error ? (
        <Alert variant="destructive">
          <AlertDescription>{server_error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="signup-email">E-mail</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          placeholder="seu@email.com"
          {...register('email', { required: 'Digite um e-mail válido.' })}
        />
        {errors.email ? (
          <p className="text-[0.8rem] font-medium text-destructive">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password">Senha (mín. 10 caracteres)</Label>
        <PasswordField
          id="signup-password"
          autoComplete="new-password"
          placeholder="Mínimo 10 caracteres, letras e números"
          {...register('password', {
            required: 'A senha deve ter pelo menos 10 caracteres.',
          })}
        />
        {errors.password ? (
          <p className="text-[0.8rem] font-medium text-destructive">
            {errors.password.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-confirm-password">Confirmar senha</Label>
        <PasswordField
          id="signup-confirm-password"
          autoComplete="new-password"
          placeholder="Repita a senha"
          {...register('confirmPassword', {
            required: 'As senhas não coincidem.',
          })}
        />
        {errors.confirmPassword ? (
          <p className="text-[0.8rem] font-medium text-destructive">
            {errors.confirmPassword.message}
          </p>
        ) : null}
      </div>

      <label className="flex items-start gap-3 cursor-pointer min-h-11">
        <input
          id="signup-consent"
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
          {...register('consent', {
            required: 'Você precisa aceitar os termos para continuar.',
          })}
        />
        <span className="text-sm text-foreground leading-relaxed">
          Li e concordo com o tratamento dos meus dados pessoais conforme
          descrito acima, os{' '}
          <a href="/legal/terms" className="text-primary hover:underline">
            Termos de Uso
          </a>{' '}
          e a{' '}
          <a href="/legal/privacy" className="text-primary hover:underline">
            Política de Privacidade
          </a>
          .
        </span>
      </label>
      {errors.consent ? (
        <p className="text-[0.8rem] font-medium text-destructive">
          {errors.consent.message}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            <span>Criando conta...</span>
          </>
        ) : (
          'Criar conta'
        )}
      </Button>
    </form>
  );
}
