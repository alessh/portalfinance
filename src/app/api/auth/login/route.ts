/**
 * POST /api/auth/login — credential check with the full security stack
 * (rate-limit + lockout + Turnstile-after-2). On success, returns
 * `{ ok: true, user_id }`; the client then calls Auth.js `signIn(...)`
 * to materialise the database session and set the cookie.
 *
 * D-05 / D-06 / D-07. Server is the source of truth for the failure
 * counter — never trust the client's count.
 */
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { users, account_locks } from '@/db/schema';
import { LoginSchema } from '@/lib/validation';
import { hashPassword, verifyPassword } from '@/lib/password';
import { checkAndIncrement, resetCounter } from '@/lib/rateLimit';
import { verifyTurnstile } from '@/lib/turnstile';
import { recordAudit } from '@/lib/auditLog';
import { enqueue } from '@/jobs/boss';

const LOGIN_FAIL_LIMIT = 5; // 5 failures in window → next is the lockout
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const UNLOCK_TOKEN_TTL_MS = 60 * 60 * 1000;
const TURNSTILE_AFTER = 2; // require Turnstile from the 3rd attempt onward

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json(
      { ok: false, error: 'Corpo inválido.' },
      { status: 400 },
    );
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'E-mail ou senha incorretos.' },
      { status: 401 },
    );
  }
  const { email, password, turnstileToken } = parsed.data;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  // Atomically increment the LOGIN counter for this email.
  const counter = await checkAndIncrement(
    email,
    'LOGIN',
    LOGIN_FAIL_LIMIT,
    LOGIN_WINDOW_MS,
  );

  // 6th and beyond → 429 + persistent account lock + unlock email.
  if (!counter.allowed) {
    await ensureAccountLock(email, ip, req.headers.get('user-agent'));
    return NextResponse.json(
      {
        ok: false,
        error:
          'Conta temporariamente bloqueada. Verifique seu e-mail.',
      },
      { status: 429 },
    );
  }

  // From the 3rd attempt onward (counter.count >= TURNSTILE_AFTER + 1)
  // require a valid Turnstile token.
  if (counter.count > TURNSTILE_AFTER) {
    const ok_turnstile = await verifyTurnstile(turnstileToken, ip);
    if (!ok_turnstile) {
      return NextResponse.json(
        {
          ok: false,
          error: 'E-mail ou senha incorretos.',
          require_turnstile: true,
        },
        { status: 401 },
      );
    }
  }

  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deleted_at)),
  });

  // Const-time equalisation even when the user is missing.
  const ok = await verifyPassword(user?.password_hash ?? null, password);

  if (!ok || !user) {
    await recordAudit({
      user_id: user?.id ?? null,
      action: 'login_failure',
      ip_address: ip,
      user_agent: req.headers.get('user-agent'),
      // D-19: never persist raw email of a failed login.
      metadata: { reason: user ? 'bad_password' : 'no_user' },
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'E-mail ou senha incorretos.',
        require_turnstile: counter.count >= TURNSTILE_AFTER,
      },
      { status: 401 },
    );
  }

  // Success — reset the LOGIN counter so the next failure window starts fresh.
  await resetCounter(email, 'LOGIN');
  await recordAudit({
    user_id: user.id,
    action: 'login_success',
    ip_address: ip,
    user_agent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ ok: true, user_id: user.id }, { status: 200 });
}

async function ensureAccountLock(
  email: string,
  ip: string | null,
  user_agent: string | null,
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deleted_at)),
  });
  if (!user) return; // Don't materialise locks for unknown emails.

  // Skip if there's already an active (unresolved + unexpired) lock.
  const active = await db.query.account_locks.findFirst({
    where: and(
      eq(account_locks.user_id, user.id),
      isNull(account_locks.unlocked_at),
    ),
  });
  if (active) return;

  const now = new Date();
  const token = randomBytes(32).toString('base64url');
  const token_hash = await hashPassword(token);

  await db.insert(account_locks).values({
    user_id: user.id,
    locked_at: now,
    unlocks_at: new Date(now.getTime() + LOGIN_WINDOW_MS),
    unlock_token_hash: token_hash,
    unlock_token_expires_at: new Date(now.getTime() + UNLOCK_TOKEN_TTL_MS),
  });

  await enqueue('send-account-unlock-email', {
    user_id: user.id,
    email: user.email,
    token,
  });

  await recordAudit({
    user_id: user.id,
    action: 'account_locked',
    ip_address: ip,
    user_agent,
  });
}
