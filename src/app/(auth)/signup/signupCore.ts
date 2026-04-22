/**
 * Signup core implementation — RESEARCH.md § Plan slice 01-02 item 2.
 *
 * Imported from BOTH `./actions.ts` (the server-action surface) and
 * `/api/auth/signup/route.ts` (the JSON surface). Single source of
 * truth: validate → hash → INSERT users + user_consents + audit_log
 * in one Drizzle transaction.
 *
 * MUST run on the Node runtime — argon2 cannot execute in the edge.
 * The runtime declaration lives on the route + on the server action's
 * caller; this file is a plain TS module.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { users, user_consents, audit_log } from '@/db/schema';
import { SignupSchema } from '@/lib/validation';
import { hashPassword } from '@/lib/password';
import { versions } from '@/lib/consentVersions';

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

export async function signup(
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
      consent_version: versions.ACCOUNT_CREATION,
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
