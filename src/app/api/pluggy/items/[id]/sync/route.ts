export const runtime = 'nodejs';

/**
 * POST /api/pluggy/items/:id/sync — manual sync trigger with cooldown enforcement.
 *
 * Plan 02-06 / CONTEXT.md D-26, D-28, D-29, D-30, CONN-06.
 *
 * Sequence:
 *   1. requireSession — 401 on failure.
 *   2. Load pluggy_items row filtered by id + user_id (IDOR, P26).
 *   3. Free-tier hard block → 403 PAYWALL (D-29).
 *   4. Cooldown check: last_synced_at < 30 min ago → 429 COOLDOWN_ACTIVE with Retry-After header (D-28).
 *   5. Enqueue PLUGGY_SYNC with trigger='manual', singletonKey=user_id (D-41).
 *   6. Write audit_log action='manual_sync_triggered' with cooldown_bypassed=false (D-13).
 *   7. Return 202 Accepted.
 *
 * SECURITY:
 *   - IDOR enforced by innerJoin on user_id = session.userId (P26); 404 on miss.
 *   - Free-tier check prevents paid-only feature abuse (T-02-C).
 *   - Cooldown is server-side: client cannot bypass by manipulating parameters (T-02-B).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { pluggy_items, users } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { enqueue, QUEUES } from '@/jobs/boss';
import { recordAudit } from '@/lib/auditLog';

/** 30-minute cooldown between manual syncs (D-28, CONN-06). */
const COOLDOWN_MS = 30 * 60 * 1000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // 1. Session gate — 401 on failure
  let session: { userId: string; email: string };
  try {
    session = await requireSession(req);
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // 2. Load item + tier in one read (IDOR via user_id filter, P26)
  const row = await db
    .select({
      item_id: pluggy_items.id,
      last_synced_at: pluggy_items.last_synced_at,
      tier: users.subscription_tier,
      status: pluggy_items.status,
    })
    .from(pluggy_items)
    .innerJoin(users, eq(users.id, pluggy_items.user_id))
    .where(and(eq(pluggy_items.id, id), eq(pluggy_items.user_id, session.userId)))
    .limit(1);

  // P26: 404 not 403 — do not reveal whether the item exists for other users
  if (row.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const it = row[0];

  // 3. Free-tier hard block (D-29, T-02-C)
  if (it.tier === 'free') {
    return NextResponse.json(
      { error: 'PAYWALL', upgrade_url: '/settings/billing' },
      { status: 403 },
    );
  }

  // 4. Cooldown enforcement (D-28, T-02-B)
  const last_synced_ms = it.last_synced_at?.getTime() ?? 0;
  const elapsed_ms = Date.now() - last_synced_ms;
  if (last_synced_ms > 0 && elapsed_ms < COOLDOWN_MS) {
    const retry_after_seconds = Math.ceil((COOLDOWN_MS - elapsed_ms) / 1000);
    return NextResponse.json(
      { error: 'COOLDOWN_ACTIVE', retry_after_seconds },
      {
        status: 429,
        headers: { 'Retry-After': String(retry_after_seconds) },
      },
    );
  }

  // 5. Enqueue PLUGGY_SYNC with per-user singletonKey (D-41 dedup)
  await enqueue(
    QUEUES.PLUGGY_SYNC,
    { user_id: session.userId, item_id: it.item_id, trigger: 'manual' },
    { singletonKey: session.userId },
  );

  // 6. Audit log (D-13)
  await recordAudit({
    user_id: session.userId,
    action: 'manual_sync_triggered',
    metadata: { item_id: it.item_id, cooldown_bypassed: false },
    ip_address: req.headers.get('x-forwarded-for'),
    user_agent: req.headers.get('user-agent'),
  });

  // 7. Return 202 Accepted — sync is always async (P5)
  return NextResponse.json({ accepted: true }, { status: 202 });
}
