/**
 * Session helpers consumed by every authenticated route.
 *
 * **SEC-01 / Pitfall P26 baseline.** Every authenticated route MUST call
 * `requireSession()` at the top and include `AND user_id = $userId` in
 * EVERY Drizzle query that reads or writes user-scoped data. Cross-user
 * reads must return 404, NOT 403 — leaking row existence is itself a
 * privacy violation.
 */
import { auth } from '@/auth';

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super('UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export async function requireSession(): Promise<{
  userId: string;
  email: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return {
    userId: session.user.id as string,
    email: (session.user.email ?? '') as string,
  };
}

export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user?.id as string | undefined) ?? null;
}
