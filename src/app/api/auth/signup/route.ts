/**
 * POST /api/auth/signup — thin JSON wrapper around `signupAction`.
 *
 * Used when a client wants to call the signup flow directly (e.g.
 * the Playwright e2e test) without invoking the React server action.
 * MUST run on the Node runtime — depends on argon2.
 */
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { signup as signupAction } from '@/app/(auth)/signup/signupCore';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === 'production' && !process.env.E2E_TEST
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 });
  }

  const ip_address =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const user_agent = req.headers.get('user-agent') ?? null;

  const result = await signupAction({
    email: String(body.email ?? ''),
    password: String(body.password ?? ''),
    confirmPassword: String(body.confirmPassword ?? ''),
    consent: body.consent === true ? true : (false as unknown as true),
    ip_address,
    user_agent,
  });

  if (!result.ok || !result.user_id) {
    return NextResponse.json(result, { status: 400 });
  }

  // Auto-sign-in the user after signup — establish the database
  // session row + set the cookie so the next request is authenticated.
  // Same pattern as /api/auth/login (Auth.js Credentials does not
  // support the `database` strategy out of the box).
  const session_token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    user_id: result.user_id,
    session_token,
    expires,
  });

  const res = NextResponse.json(result, { status: 201 });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session_token,
    httpOnly: true,
    secure: SESSION_COOKIE_NAME.startsWith('__Secure-'),
    sameSite: 'lax',
    path: '/',
    expires,
  });
  return res;
}
