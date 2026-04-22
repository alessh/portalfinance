'use client';
/**
 * PasswordResetRequestForm — UI-SPEC § 2.4.
 *
 * Single email field. Anti-enumeration success state replaces the form
 * regardless of whether the email exists (D-08).
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface RequestValues {
  email: string;
}

export function PasswordResetRequestForm() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RequestValues>();

  async function onSubmit(values: RequestValues) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (res.status === 429) {
        setError('Muitas tentativas. Aguarde antes de tentar novamente.');
        return;
      }
      setDone(true);
    } catch {
      setError('Sem conexão. Verifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Alert>
        <AlertDescription>
          Se esse e-mail estiver cadastrado, você receberá um link em
          breve. Verifique também a caixa de spam.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="reset-email">E-mail</Label>
        <Input
          id="reset-email"
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

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            <span>Enviando...</span>
          </>
        ) : (
          'Enviar link de recuperação'
        )}
      </Button>
    </form>
  );
}
