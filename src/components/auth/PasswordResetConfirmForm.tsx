'use client';
/**
 * PasswordResetConfirmForm — UI-SPEC § 2.5.
 *
 * Validates the token via /api/auth/reset/validate on mount. New
 * password + confirm fields with a 3-segment strength indicator
 * (visual only — Zod enforces the policy on the server).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PasswordField } from './PasswordField';

interface ConfirmValues {
  password: string;
  confirmPassword: string;
}

interface Props {
  token: string;
}

function passwordStrength(p: string): 0 | 1 | 2 | 3 {
  let score = 0;
  if (p.length >= 10) score++;
  if (/[a-zA-Z]/.test(p) && /\d/.test(p)) score++;
  if (p.length >= 14 && /[^a-zA-Z0-9]/.test(p)) score++;
  return score as 0 | 1 | 2 | 3;
}

export function PasswordResetConfirmForm({ token }: Props) {
  const router = useRouter();
  const [valid, setValid] = useState<boolean | null>(null);
  const [server_error, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ConfirmValues>();

  const current_password = watch('password') ?? '';
  const score = passwordStrength(current_password);

  useEffect(() => {
    let active = true;
    fetch(`/api/auth/reset/validate?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!active) return;
        setValid(r.ok);
      })
      .catch(() => {
        if (active) setValid(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (valid === false) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Este link expirou ou já foi utilizado.{' '}
          <a href="/reset" className="underline">
            Solicitar novo link
          </a>
        </AlertDescription>
      </Alert>
    );
  }

  if (valid === null) {
    return (
      <p className="text-sm text-muted-foreground">Validando link...</p>
    );
  }

  async function onSubmit(values: ConfirmValues) {
    setServerError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, token }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setServerError(json.error ?? 'Algo deu errado. Tente novamente.');
        return;
      }
      router.push('/login?reset=ok');
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
        <Label htmlFor="confirm-password">Nova senha</Label>
        <PasswordField
          id="confirm-password"
          autoComplete="new-password"
          placeholder="Mínimo 10 caracteres, letras e números"
          {...register('password', {
            required: 'A senha deve ter pelo menos 10 caracteres.',
          })}
        />
        <div
          className="flex gap-1 mt-1"
          aria-label="Força da senha"
          role="presentation"
        >
          <div
            className={`h-1 flex-1 rounded ${score >= 1 ? 'bg-destructive' : 'bg-muted'}`}
          />
          <div
            className={`h-1 flex-1 rounded ${score >= 2 ? 'bg-warning' : 'bg-muted'}`}
          />
          <div
            className={`h-1 flex-1 rounded ${score >= 3 ? 'bg-success' : 'bg-muted'}`}
          />
        </div>
        {errors.password ? (
          <p className="text-[0.8rem] font-medium text-destructive">
            {errors.password.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password-2">Confirmar nova senha</Label>
        <PasswordField
          id="confirm-password-2"
          autoComplete="new-password"
          placeholder="Repita a nova senha"
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

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            <span>Redefinindo...</span>
          </>
        ) : (
          'Redefinir senha'
        )}
      </Button>
    </form>
  );
}
