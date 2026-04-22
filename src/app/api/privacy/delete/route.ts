/**
 * POST /api/privacy/delete — LGPD Data Subject Request: account deletion.
 *
 * Phase 1 scope (D-17): Creates a dsr_requests row with status='PENDING'
 * and enqueues a pg-boss acknowledgment job. Does NOT execute the actual
 * deletion — that is Phase 6.
 *
 * Three security gates (T-DSR-ABUSE mitigation):
 *   1. requireSession() — must be authenticated
 *   2. Turnstile token verification — automated abuse prevention
 *   3. confirm_phrase === 'EXCLUIR' — explicit user confirmation
 *
 * Note: Turnstile failure returns 400 (not 403). The user is already
 * authenticated, so this is not an auth issue — it's a validation failure.
 * This is consistent with the convention from Plan 01-02's anti-enumeration
 * pattern for the delete endpoint specifically.
 */
export const runtime = 'nodejs';

import { requireSession } from '@/lib/session';
import { db } from '@/db';
import { dsr_requests } from '@/db/schema';
import { enqueue, QUEUES } from '@/jobs/boss';
import { verifyTurnstile } from '@/lib/turnstile';
import { z } from 'zod';

const BodySchema = z.object({
  confirm_phrase: z.literal('EXCLUIR'),
  turnstile_token: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const { userId, email } = await requireSession(req);

    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return Response.json({ error: 'invalid_body' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ok = await verifyTurnstile(body.turnstile_token, ip);
    if (!ok) {
      return Response.json({ error: 'turnstile_failed' }, { status: 400 });
    }

    const [row] = await db
      .insert(dsr_requests)
      .values({
        user_id: userId,
        request_type: 'DELETE',
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
