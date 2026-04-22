/**
 * POST /api/privacy/export — LGPD Data Subject Request: data export.
 *
 * Phase 1 scope (D-17): Creates a dsr_requests row with status='PENDING'
 * and enqueues a pg-boss acknowledgment job. Does NOT execute the actual
 * data export — that is Phase 6.
 *
 * LGPD Art. 19: 15-day statutory response window for access requests.
 *
 * Security:
 *   - requireSession() gates access (SEC-01 IDOR baseline)
 *   - No Turnstile required (authenticated route, low abuse risk for export)
 *   - Rate limiting: TODO Plan 01-04 extension (documented as deferred)
 */
export const runtime = 'nodejs';

import { requireSession } from '@/lib/session';
import { db } from '@/db';
import { dsr_requests } from '@/db/schema';
import { enqueue, QUEUES } from '@/jobs/boss';

export async function POST(req: Request) {
  try {
    const { userId, email } = await requireSession(req);

    const [row] = await db
      .insert(dsr_requests)
      .values({
        user_id: userId,
        request_type: 'EXPORT',
        status: 'PENDING',
      })
      .returning();

    if (!row) throw new Error('Failed to create DSR row');

    await enqueue(QUEUES.DSR_ACKNOWLEDGE, {
      dsr_request_id: row.id,
      user_email: email,
    });

    return Response.json({ protocol: row.id }, { status: 201 });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const is_auth = status === 401;
    return Response.json(
      { error: is_auth ? 'unauthorized' : 'failed' },
      { status },
    );
  }
}
