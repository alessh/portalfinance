export const runtime = 'nodejs';

/**
 * DELETE /api/pluggy/items/:id — disconnect a bank connection.
 *
 * Plan 02-06 / CONTEXT.md D-04, LGPD-02.
 *
 * Sequence (atomicity: Pluggy first, local state only on success):
 *   1. requireSession — 401 on failure.
 *   2. Load pluggy_items row filtered by id + user_id (IDOR, P26); 404 on miss.
 *   3. Call PluggyService.deleteItem — 502 PLUGGY_API_ERROR on failure (no local mutation).
 *   4. Soft-delete accounts: mark all ACTIVE accounts under this item as DELETED.
 *   5. Append-only consent revocation: insert user_consents row with action='REVOKED' (LGPD-02, D-04).
 *   6. Write audit_log action='item_disconnected' (D-13).
 *   7. Return 200 { disconnected: true }.
 *
 * NOTE: The pluggy_items row is NOT deleted — transaction history is preserved per D-04.
 *       Future Phase 6 LGPD deletion workflow handles full data removal.
 *
 * SECURITY:
 *   - IDOR enforced by findFirst with user_id = session.userId (P26); 404 on miss.
 *   - Pluggy is called FIRST — Pluggy failure → local state unchanged (T-02-E atomicity).
 *   - Consent revocation is append-only; rows are never updated or deleted (LGPD Art. 7).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { accounts, pluggy_items, user_consents } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { getPluggyService } from '@/services/PluggyService';
import { recordAudit } from '@/lib/auditLog';
import { getPluggyConsentVersionHash } from '@/lib/consentVersions';

export async function DELETE(
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

  // 2. Load pluggy_items row with IDOR guard (P26)
  const [it] = await db
    .select({
      id: pluggy_items.id,
      pluggy_item_id_enc: pluggy_items.pluggy_item_id_enc,
      connector_id: pluggy_items.connector_id,
      institution_name: pluggy_items.institution_name,
    })
    .from(pluggy_items)
    .where(and(eq(pluggy_items.id, id), eq(pluggy_items.user_id, session.userId)))
    .limit(1);

  // P26: 404 not 403 — do not reveal whether the item exists for other users
  if (!it) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // 3. Call Pluggy DELETE first — if this fails, do NOT mutate local state (T-02-E)
  try {
    await getPluggyService().deleteItem({
      user_id: session.userId,
      item_id_enc: it.pluggy_item_id_enc,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'PLUGGY_API_ERROR', message: String(err) },
      { status: 502 },
    );
  }

  // 4. Soft-delete: mark all ACTIVE accounts under this item as DELETED
  //    Transactions remain readable (history preserved per D-04)
  await db
    .update(accounts)
    .set({ status: 'DELETED', updated_at: new Date() })
    .where(eq(accounts.pluggy_item_id, it.id));

  // 5. Append-only consent revocation (LGPD-02 + D-04)
  //    scope='PLUGGY_CONNECTOR:{connector_id}' mirrors the GRANTED row written at connect time
  await db.insert(user_consents).values({
    user_id: session.userId,
    scope: `PLUGGY_CONNECTOR:${it.connector_id}`,
    action: 'REVOKED',
    consent_version: getPluggyConsentVersionHash(),
    revoked_at: new Date(),
    ip_address: req.headers.get('x-forwarded-for'),
    user_agent: req.headers.get('user-agent'),
  });

  // 6. Audit log (D-13)
  await recordAudit({
    user_id: session.userId,
    action: 'item_disconnected',
    metadata: {
      connector_id: it.connector_id,
      institution_name: it.institution_name,
    },
    ip_address: req.headers.get('x-forwarded-for'),
    user_agent: req.headers.get('user-agent'),
  });

  // 7. Return 200 — disconnected
  return NextResponse.json({ disconnected: true });
}
