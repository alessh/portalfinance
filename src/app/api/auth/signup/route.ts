/**
 * POST /api/auth/signup — thin JSON wrapper around `signupAction`.
 *
 * Used when a client wants to call the signup flow directly (e.g.
 * the Playwright e2e test) without invoking the React server action.
 * MUST run on the Node runtime — depends on argon2.
 */
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { signupAction } from '@/app/(auth)/signup/actions';

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

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
