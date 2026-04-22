/**
 * Zod v4 schemas for the auth surface — signup, login, password reset.
 *
 * Password policy (Claude's Discretion in 01-CONTEXT.md):
 *   - min 10 chars
 *   - at least 1 letter and 1 number
 *   - rejected if it appears in `COMMON_PASSWORDS`
 *
 * Pt-BR error messages match UI-SPEC § Copywriting "Validation Errors".
 * Email is trimmed and lowercased on parse so duplicate detection works.
 */
import { z } from 'zod';
import { COMMON_PASSWORDS } from './common-passwords';

const PasswordSchema = z
  .string()
  .min(10, { message: 'A senha deve ter pelo menos 10 caracteres.' })
  .refine((p) => /[a-zA-Z]/.test(p), {
    message: 'Use letras e números na senha.',
  })
  .refine((p) => /\d/.test(p), { message: 'Use letras e números na senha.' })
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), {
    message: 'Essa senha é muito comum. Escolha outra.',
  });

export const SignupSchema = z
  .object({
    email: z
      .string()
      .email({ message: 'Digite um e-mail válido.' })
      .transform((s) => s.trim().toLowerCase()),
    password: PasswordSchema,
    confirmPassword: z.string(),
    consent: z.literal(true, {
      message: 'Você precisa aceitar os termos para continuar.',
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'As senhas não coincidem.',
    path: ['confirmPassword'],
  });

export const LoginSchema = z.object({
  email: z
    .string()
    .email({ message: 'Digite um e-mail válido.' })
    .transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1),
  // Present from the 2nd failed attempt onward (D-07).
  turnstileToken: z.string().optional(),
});

export const PasswordResetRequestSchema = z.object({
  email: z
    .string()
    .email({ message: 'Digite um e-mail válido.' })
    .transform((s) => s.trim().toLowerCase()),
});

export const PasswordResetConfirmSchema = z
  .object({
    token: z.string().min(16),
    password: PasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'As senhas não coincidem.',
    path: ['confirmPassword'],
  });

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type PasswordResetRequestInput = z.infer<
  typeof PasswordResetRequestSchema
>;
export type PasswordResetConfirmInput = z.infer<
  typeof PasswordResetConfirmSchema
>;
