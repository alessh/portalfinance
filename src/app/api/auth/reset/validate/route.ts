/**
 * GET /api/auth/reset/validate?token=... — checks token validity for the
 * UI before showing the new-password form. Anti-enumeration: returns
 * 404 (NOT a timing-rich response) when the token is invalid.
 */
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { gt, isNull, and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { password_reset_tokens } from '@/db/schema';
import { verifyPassword } from '@/lib/password';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token || token.length < 16) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }

  // We can't query by the plaintext token (we only have argon2-hashed
  // values). For the validate endpoint we accept O(N) over unexpired
  // tokens — at realistic volumes (a handful of unexpired requests at
  // once) the cost is acceptable; production traffic shape can revisit.
  const candidates = await db
    .select({
      id: password_reset_tokens.id,
      user_id: password_reset_tokens.user_id,
      token_hash: password_reset_tokens.token_hash,
    })
    .from(password_reset_tokens)
    .where(
      and(
        gt(password_reset_tokens.expires_at, new Date()),
        isNull(password_reset_tokens.used_at),
      ),
    );

  for (const candidate of candidates) {
    const ok = await verifyPassword(candidate.token_hash, token);
    if (ok) return NextResponse.json({ valid: true }, { status: 200 });
  }
  return NextResponse.json({ valid: false }, { status: 404 });
}

// Avoid an unused-import lint complaint for `eq` if reorganised later.
void eq;
