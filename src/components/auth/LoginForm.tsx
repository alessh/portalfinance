'use client';
/**
 * LoginForm — UI-SPEC § 2.3.
 *
 * Email + password. After the 2nd failed attempt, the Turnstile slot
 * appears (server is the source of truth — `require_turnstile` flag in
 * the response). Generic error "E-mail ou senha incorretos." for both
 * "no user" and "wrong password" — anti-enumeration.
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
import { TurnstileSlot } from './TurnstileSlot';

interface LoginFormValues {
  email: string;
  password: string;
}

export function LoginForm() {
  const router = useRouter();
  const [server_error, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [show_turnstile, setShowTurnstile] = useState(false);
  const [turnstile_token, setTurnstileToken] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>();

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          turnstileToken: turnstile_token,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        require_turnstile?: boolean;
      };

      if (res.status === 429) {
        router.push('/locked');
        return;
      }

      if (!res.ok || !json.ok) {
        if (json.require_turnstile) setShowTurnstile(true);
        setServerError(json.error ?? 'E-mail ou senha incorretos.');
        return;
      }

      // The login route sets the session cookie itself — just navigate.
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
        <Label htmlFor="login-email">E-mail</Label>
        <Input
          id="login-email"
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
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">Senha</Label>
          <a
            href="/reset"
            className="text-sm text-primary hover:underline"
          >
            Esqueceu a senha?
          </a>
        </div>
        <PasswordField
          id="login-password"
          autoComplete="current-password"
          {...register('password', { required: true })}
        />
      </div>

      {show_turnstile ? (
        <TurnstileSlot onSuccess={(token) => setTurnstileToken(token)} />
      ) : null}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            <span>Entrando...</span>
          </>
        ) : (
          'Entrar na conta'
        )}
      </Button>
    </form>
  );
}
