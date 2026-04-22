/**
 * POST /api/auth/reset/confirm — sets the new password, marks the token
 * used, DELETES all sessions for the user (SEC-02 session rotation),
 * and writes an audit_log row.
 */
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { gt, isNull, and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  password_reset_tokens,
  users,
  sessions,
} from '@/db/schema';
import { PasswordResetConfirmSchema } from '@/lib/validation';
import { hashPassword, verifyPassword } from '@/lib/password';
import { recordAudit } from '@/lib/auditLog';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 });
  }

  const parsed = PasswordResetConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Dados inválidos.' },
      { status: 400 },
    );
  }
  const { token, password } = parsed.data;

  const candidates = await db
    .select()
    .from(password_reset_tokens)
    .where(
      and(
        gt(password_reset_tokens.expires_at, new Date()),
        isNull(password_reset_tokens.used_at),
      ),
    );

  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (await verifyPassword(candidate.token_hash, token)) {
      matched = candidate;
      break;
    }
  }
  if (!matched) {
    return NextResponse.json(
      { ok: false, error: 'Este link expirou ou já foi utilizado.' },
      { status: 404 },
    );
  }

  const password_hash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx
      .update(password_reset_tokens)
      .set({ used_at: new Date() })
      .where(eq(password_reset_tokens.id, matched!.id));
    await tx
      .update(users)
      .set({ password_hash })
      .where(eq(users.id, matched!.user_id));
    // SEC-02 — invalidate every existing session.
    await tx.delete(sessions).where(eq(sessions.user_id, matched!.user_id));
  });

  await recordAudit({
    user_id: matched.user_id,
    action: 'password_reset_completed',
    ip_address:
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    user_agent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
