/**
 * POST /api/auth/logout — AUTH-03 server-side session invalidation.
 *
 * DELETEs the session row keyed on the cookie's session_token, then
 * clears the cookie. After the response, the next request has no
 * server-side session — middleware redirects /dashboard to /login.
 */
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { recordAudit } from '@/lib/auditLog';

const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === 'production' && !process.env.E2E_TEST
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const [row] = await db
      .delete(sessions)
      .where(eq(sessions.session_token, token))
      .returning({ user_id: sessions.user_id });
    if (row) {
      await recordAudit({
        user_id: row.user_id,
        action: 'logout',
      });
    }
  }
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: SESSION_COOKIE_NAME.startsWith('__Secure-'),
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  });
  return res;
}
