/**
 * POST /api/auth/email/resend — Phase 1 stub (D-02).
 *
 * Returns 501 Not Implemented. The real SES-backed email verification flow
 * ships in Phase 2. The Email Verification Nag Banner already calls this
 * endpoint optimistically and swallows the response — this stub exists so
 * Auth.js's catch-all does not return a misleading 400 for an unknown
 * action and pollute Sentry.
 */
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'not_implemented' },
    { status: 501 },
  );
}
