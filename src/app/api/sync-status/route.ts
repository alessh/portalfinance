export const runtime = 'nodejs';
/**
 * GET /api/sync-status — polling endpoint for /connect/success progress card.
 *
 * Plan 02-03 / CONTEXT.md D-03.
 *
 * Returns the phase of the most recent pluggy_items sync for the session user:
 *   - 'connecting'         → item exists but status != UPDATING and no accounts yet
 *   - 'loading_accounts'   → item.status=UPDATING and no accounts yet
 *   - 'loading_transactions' → accounts exist but no transactions yet
 *   - 'completed'          → at least 1 transaction exists
 *   - 'no_items'           → no pluggy_items for this user
 *
 * SECURITY:
 *   - requireSession() is the FIRST call — 401 before any DB read (P26 / T-02-F).
 *   - Every query is scoped to session.userId (IDOR guard).
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { pluggy_items, accounts, transactions } from '@/db/schema';
import { requireSession } from '@/lib/session';

export async function GET(req: Request): Promise<Response> {
  // Session gate — MUST be first (T-02-F mitigation).
  const session = await requireSession(req);

  // Find the user's most recently created pluggy_item.
  const item = await db.query.pluggy_items.findFirst({
    where: (pi, { eq }) => eq(pi.user_id, session.userId),
    orderBy: (pi, { desc }) => [desc(pi.created_at)],
    columns: { id: true, status: true },
  });

  if (!item) {
    return NextResponse.json({ phase: 'no_items', transactions_count: 0 });
  }

  // Count accounts for this item (IDOR: scoped to item.id which belongs to session.userId).
  const accountCountResult = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.pluggy_item_id, item.id));
  const account_count = (accountCountResult[0]?.n as number) ?? 0;

  // Count transactions for this user (IDOR: user_id column).
  const txCountResult = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.user_id, session.userId));
  const tx_count = (txCountResult[0]?.n as number) ?? 0;

  // Determine sync phase.
  let phase: 'connecting' | 'loading_accounts' | 'loading_transactions' | 'completed';
  if (tx_count > 0) {
    phase = 'completed';
  } else if (account_count > 0) {
    phase = 'loading_transactions';
  } else if (item.status === 'UPDATING') {
    phase = 'loading_accounts';
  } else {
    phase = 'connecting';
  }

  return NextResponse.json({ phase, transactions_count: tx_count });
}
