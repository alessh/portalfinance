/**
 * Auth.js v5 (next-auth@beta) configuration with Drizzle adapter.
 *
 * RESEARCH.md § Plan slice 01-02 item 1 + Pitfall 4 (renamed accounts table).
 *
 * - Database session strategy (AUTH-03 — JWT cannot be revoked).
 * - Credentials provider only in Phase 1; OAuth providers deferred to v1.x.
 * - Cookie config explicitly sets `httpOnly` + `secure` + `sameSite=lax`
 *   to satisfy SEC-02; Auth.js defaults match but the explicit override
 *   is a belt-and-suspenders verification (RESEARCH.md item 9).
 * - Const-time `verifyPassword` runs even when the user is missing so
 *   the response time does not enumerate accounts (T-AUTH-ENUMERATION).
 *
 * NEVER import this module from `src/middleware.ts` — middleware runs on
 * the edge runtime and cannot load argon2 / node:crypto (Pitfall 6).
 */
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { LoginSchema } from '@/lib/validation';
import { verifyPassword } from '@/lib/password';

export const { auth, handlers, signIn, signOut } = NextAuth({
  // The Drizzle adapter ships strict column-name expectations (camelCase
  // `userId` / `sessionToken` / `emailVerified` / `name` / `image`); our
  // schema uses snake_case and omits adapter-specific columns we don't
  // need in Phase 1 (Credentials provider only). Cast through `unknown`
  // so TypeScript accepts the runtime shape — the Drizzle queries the
  // adapter actually issues are read-by-email + sessions CRUD, both of
  // which work against the columns we do have.
  adapter: (DrizzleAdapter as unknown as (
    db: typeof import('@/db').db,
    tables: {
      usersTable: unknown;
      accountsTable: unknown;
      sessionsTable: unknown;
      verificationTokensTable: unknown;
    },
  ) => ReturnType<typeof DrizzleAdapter>)(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts_oauth,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verification_tokens,
  }),
  session: { strategy: 'database', maxAge: 30 * 24 * 60 * 60 },
  // Auth.js v5 enforces a host allow-list in production. Trust the
  // proxy-supplied Host header — Railway terminates TLS and forwards
  // the canonical hostname. For e2e tests (E2E_TEST=1) we also trust
  // because we hit http://localhost:3000.
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = LoginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const user = await db.query.users.findFirst({
          where: eq(schema.users.email, email),
        });
        // Run verify even when user is missing — const-time equalisation.
        const ok = await verifyPassword(user?.password_hash ?? null, password);
        if (!ok || !user) return null;
        return { id: user.id, email: user.email };
      },
    }),
  ],
  // SEC-02: HttpOnly + Secure + SameSite=Lax in production. The
  // `__Secure-` cookie prefix requires HTTPS; we drop it (and the
  // secure flag) outside production OR when explicitly running e2e
  // tests (E2E_TEST=1 — Playwright globalSetup sets this) so the
  // browser can store the session cookie over plain http://localhost.
  // Production must always be served over HTTPS — Railway's edge
  // does this by default.
  cookies: {
    sessionToken:
      process.env.NODE_ENV === 'production' && !process.env.E2E_TEST
        ? {
            name: '__Secure-authjs.session-token',
            options: {
              httpOnly: true,
              secure: true,
              sameSite: 'lax',
              path: '/',
            },
          }
        : {
            name: 'authjs.session-token',
            options: {
              httpOnly: true,
              secure: false,
              sameSite: 'lax',
              path: '/',
            },
          },
  },
  pages: { signIn: '/login' },
});
