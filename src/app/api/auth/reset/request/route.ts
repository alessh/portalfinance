/**
 * POST /api/auth/reset/request — AUTH-04 + D-08 anti-enumeration.
 *
 * Per-email cap: 3 / hour (D-08). Per-IP cap: 10 / hour (D-08). Both
 * counters live in `auth_rate_limits`. Response body is identical
 * regardless of whether the email exists — anti-enumeration baseline.
 *
 * On a hit (and only on a hit), generate a 32-byte random token,
 * argon2-hash it, INSERT into `password_reset_tokens`, and enqueue a
 * `send-password-reset-email` job. Plan 01-03 wires the actual email.
 */
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { users, password_reset_tokens } from '@/db/schema';
import { PasswordResetRequestSchema } from '@/lib/validation';
import { hashPassword } from '@/lib/password';
import { checkAndIncrement } from '@/lib/rateLimit';
import { recordAudit } from '@/lib/auditLog';
import { enqueue } from '@/jobs/boss';

const ONE_HOUR_MS = 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = ONE_HOUR_MS;
const RESET_PER_EMAIL_LIMIT = 3;
const RESET_PER_IP_LIMIT = 10;

const SAME_RESPONSE = { ok: true } as const;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return NextResponse.json(SAME_RESPONSE, { status: 200 });

  const parsed = PasswordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Anti-enumeration: do not surface "invalid email" any differently
    // from "valid but no account."
    return NextResponse.json(SAME_RESPONSE, { status: 200 });
  }

  const { email } = parsed.data;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown-ip';

  // Per-IP cap first — cheaper, blocks distributed spam regardless of email.
  const ip_check = await checkAndIncrement(
    ip,
    'PASSWORD_RESET_IP',
    RESET_PER_IP_LIMIT,
    ONE_HOUR_MS,
  );
  if (!ip_check.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Muitas tentativas. Aguarde antes de tentar novamente.' },
      { status: 429 },
    );
  }

  // Per-email cap.
  const email_check = await checkAndIncrement(
    email,
    'PASSWORD_RESET',
    RESET_PER_EMAIL_LIMIT,
    ONE_HOUR_MS,
  );
  if (!email_check.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Muitas tentativas. Aguarde antes de tentar novamente.' },
      { status: 429 },
    );
  }

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deleted_at)),
  });

  // Generate + persist token only if the user exists. Same response either way.
  if (user) {
    const token = randomBytes(32).toString('base64url');
    const token_hash = await hashPassword(token);
    await db.insert(password_reset_tokens).values({
      user_id: user.id,
      token_hash,
      expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    await enqueue('send-password-reset-email', {
      user_id: user.id,
      email: user.email,
      token,
    });
    await recordAudit({
      user_id: user.id,
      action: 'password_reset_requested',
      ip_address: ip,
      user_agent: req.headers.get('user-agent'),
    });
  }

  return NextResponse.json(SAME_RESPONSE, { status: 200 });
}
