/**
 * Session helpers consumed by every authenticated route.
 *
 * **SEC-01 / Pitfall P26 baseline.** Every authenticated route MUST call
 * `requireSession()` at the top and include `AND user_id = $userId` in
 * EVERY Drizzle query that reads or writes user-scoped data. Cross-user
 * reads must return 404, NOT 403 — leaking row existence is itself a
 * privacy violation.
 *
 * Implementation: Auth.js v5's Credentials provider does NOT support
 * the `database` session strategy out of the box (it errors with
 * `UnsupportedStrategy` during signIn), so the auth routes write the
 * `sessions` row themselves and we read it back here directly via
 * Drizzle. The cookie name + Drizzle table layout match what the
 * Auth.js Drizzle adapter expects, so a future swap to a v5-stable
 * non-Credentials provider (e.g., email magic link) can drop in
 * without a session migration.
 */
import { cookies } from 'next/headers';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super('UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === 'production' && !process.env.E2E_TEST
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

async function readSession(): Promise<{
  userId: string;
  email: string;
} | null> {
  const cookie_store = await cookies();
  const token = cookie_store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const rows = await db
    .select({
      user_id: sessions.user_id,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.user_id))
    .where(
      and(
        eq(sessions.session_token, token),
        gt(sessions.expires, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { userId: row.user_id, email: row.email };
}

export async function requireSession(): Promise<{
  userId: string;
  email: string;
}> {
  const session = await readSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export async function getSessionUserId(): Promise<string | null> {
  const session = await readSession();
  return session?.userId ?? null;
}
