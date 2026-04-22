'use server';
/**
 * Signup server action — RESEARCH.md § Plan slice 01-02 item 2.
 *
 * Sign-up is NOT routed through Auth.js (Auth.js Credentials provider
 * only handles `authorize` for login). The whole flow runs in a single
 * Drizzle transaction:
 *
 *   1. Validate input with `SignupSchema` (Zod).
 *   2. Hash password with argon2id (`hashPassword`).
 *   3. INSERT users + user_consents + audit_log.
 *   4. Return the created `user_id` so the client can call `signIn(...)`.
 *
 * MUST run on the Node runtime — argon2 cannot execute in the edge.
 */
export const runtime = 'nodejs';

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { users, user_consents, audit_log } from '@/db/schema';
import { SignupSchema } from '@/lib/validation';
import { hashPassword } from '@/lib/password';
import { CONSENT_VERSION_ACCOUNT_CREATION } from '@/lib/consentVersions';

export interface SignupActionResult {
  ok: boolean;
  user_id?: string;
  error?: string;
  field_errors?: Record<string, string>;
}

export interface SignupActionInput {
  email: string;
  password: string;
  confirmPassword: string;
  consent: true;
  ip_address?: string | null;
  user_agent?: string | null;
}

export async function signupAction(
  raw: SignupActionInput,
): Promise<SignupActionResult> {
  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) {
    const field_errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || 'form';
      if (!field_errors[path]) field_errors[path] = issue.message;
    }
    return { ok: false, error: 'Dados inválidos.', field_errors };
  }

  const { email, password } = parsed.data;

  // Pre-check for duplicate email — UNIQUE index will also catch it but
  // we want a friendly message rather than a Postgres error string.
  const existing = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deleted_at)),
  });
  if (existing) {
    return {
      ok: false,
      error: 'Este e-mail já está cadastrado.',
      field_errors: { email: 'Este e-mail já está cadastrado.' },
    };
  }

  const password_hash = await hashPassword(password);

  const user_id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ email, password_hash })
      .returning({ id: users.id });
    if (!created) throw new Error('Failed to create user');

    await tx.insert(user_consents).values({
      user_id: created.id,
      scope: 'ACCOUNT_CREATION',
      action: 'GRANTED',
      consent_version: CONSENT_VERSION_ACCOUNT_CREATION,
      ip_address: raw.ip_address ?? null,
      user_agent: raw.user_agent ?? null,
      granted_at: new Date(),
    });

    await tx.insert(audit_log).values({
      user_id: created.id,
      actor_type: 'USER',
      action: 'signup',
      ip_address: raw.ip_address ?? null,
      user_agent: raw.user_agent ?? null,
    });

    return created.id;
  });

  return { ok: true, user_id };
}
