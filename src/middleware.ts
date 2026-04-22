/**
 * Edge-safe middleware — Pitfall 6.
 *
 * Runs on the Vercel/Next edge runtime. CANNOT import `argon2`,
 * `node:crypto.createCipheriv`, or anything that pulls in `@/auth`,
 * `@/lib/crypto`, `@/lib/password`. Only checks for the presence of
 * the session cookie and redirects unauthenticated users away from
 * protected routes.
 *
 * The actual session validation happens in the route handler via
 * `requireSession()` (which runs on the Node runtime).
 */
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/settings'];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const is_protected = PROTECTED_PREFIXES.some((p) => path.startsWith(p));
  if (!is_protected) return NextResponse.next();

  const has_session =
    req.cookies.has('__Secure-authjs.session-token') ||
    req.cookies.has('authjs.session-token');

  if (!has_session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*'],
};
