/**
 * GET /api/auth/unlock?token=... — validates an account-unlock token
 * sent by email after a 5-failure lockout (D-06). Marks the lock row
 * `unlocked_at = now()`, sets `unlocked_via = 'EMAIL_LINK'`, and
 * redirects to `/unlock?result=ok` (or `?result=expired`).
 */
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { gt, isNull, and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { account_locks } from '@/db/schema';
import { verifyPassword } from '@/lib/password';
import { recordAudit } from '@/lib/auditLog';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || token.length < 16) {
    return NextResponse.redirect(
      new URL('/unlock?result=expired', req.nextUrl.origin),
    );
  }

  const candidates = await db
    .select()
    .from(account_locks)
    .where(
      and(
        gt(account_locks.unlock_token_expires_at, new Date()),
        isNull(account_locks.unlocked_at),
      ),
    );

  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (await verifyPassword(candidate.unlock_token_hash, token)) {
      matched = candidate;
      break;
    }
  }
  if (!matched) {
    return NextResponse.redirect(
      new URL('/unlock?result=expired', req.nextUrl.origin),
    );
  }

  await db
    .update(account_locks)
    .set({ unlocked_at: new Date(), unlocked_via: 'EMAIL_LINK' })
    .where(eq(account_locks.id, matched.id));

  await recordAudit({
    user_id: matched.user_id,
    action: 'account_unlocked',
    metadata: { via: 'EMAIL_LINK' },
  });

  return NextResponse.redirect(
    new URL('/unlock?result=ok', req.nextUrl.origin),
  );
}
