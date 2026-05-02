export const runtime = 'nodejs';
/**
 * POST /api/pluggy/items — persist Pluggy item after widget success.
 *
 * Plan 02-03 / CONTEXT.md D-07, D-08 step 2, D-13, D-41.
 *
 * Called by ConnectIsland after PluggyConnect.onSuccess fires. Sequence:
 *   1. requireSession — 401 on failure.
 *   2. Validate body: pluggy_item_id, connector_id, institution_name required.
 *   3. Encrypt pluggy_item_id (AES-256-GCM) + HMAC-hash it (P4 / CONN-07).
 *   4. INSERT pluggy_items — 409 on UNIQUE(user_id, pluggy_item_id_hash) violation.
 *   5. INSERT user_consents with scope='PLUGGY_CONNECTOR:{connector_id}' (D-08 step 2).
 *   6. Enqueue pluggy.sync with singletonKey=user_id, singletonHours=0 (D-41).
 *   7. Write audit_log row with action='item_connected' (D-13).
 *   8. Return 202 Accepted with { id: pluggy_items.id }.
 *
 * SECURITY:
 *   - pluggy_item_id encrypted at rest, never returned plaintext (P4).
 *   - hashPluggyItemId uses distinct PLUGGY_ITEM_ID_HASH_PEPPER (OQ#6 / RESEARCH).
 *   - user_id IDOR enforced by session gate (P26).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { pluggy_items, user_consents } from '@/db/schema';
import { encryptCPF as encrypt, hashPluggyItemId } from '@/lib/crypto';
import { requireSession } from '@/lib/session';
import { getPluggyConsentVersionHash } from '@/lib/consentVersions';
import { recordAudit } from '@/lib/auditLog';
import { enqueue, QUEUES } from '@/jobs/boss';

const Body = z.object({
  pluggy_item_id: z.string().min(1),
  connector_id: z.string().min(1),
  institution_name: z.string().min(1),
  institution_logo_url: z.string().url().optional().nullable(),
});

export async function POST(req: Request): Promise<Response> {
  // 1. Session gate.
  const session = await requireSession(req);

  // 2. Parse + validate body.
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  // 3. Encrypt + hash the Pluggy item ID (P4 / CONN-07).
  //    encryptCPF is a generic AES-256-GCM helper — reused for pluggy_item_id (PATTERNS.md S6).
  //    hashPluggyItemId uses distinct PLUGGY_ITEM_ID_HASH_PEPPER (OQ#6 resolved).
  const item_enc = encrypt(body.pluggy_item_id);
  const item_hash = hashPluggyItemId(body.pluggy_item_id);

  // 4. Insert pluggy_items — handle UNIQUE(user_id, pluggy_item_id_hash) violation.
  let inserted_id: string;
  try {
    const rows = await db
      .insert(pluggy_items)
      .values({
        user_id: session.userId,
        pluggy_item_id_enc: item_enc,
        pluggy_item_id_hash: item_hash,
        connector_id: body.connector_id,
        institution_name: body.institution_name,
        institution_logo_url: body.institution_logo_url ?? null,
        status: 'UPDATING',
      })
      .returning({ id: pluggy_items.id });
    inserted_id = rows[0].id;
  } catch (err) {
    // UNIQUE(user_id, pluggy_item_id_hash) violation → 409 Conflict.
    if (String(err).includes('pluggy_items_user_item_hash_unique')) {
      return NextResponse.json({ error: 'ALREADY_CONNECTED' }, { status: 409 });
    }
    throw err;
  }

  // 5. Per-connector consent row (D-08 step 2): scope='PLUGGY_CONNECTOR:{connector_id}'.
  await db.insert(user_consents).values({
    user_id: session.userId,
    scope: `PLUGGY_CONNECTOR:${body.connector_id}`,
    action: 'GRANTED',
    consent_version: getPluggyConsentVersionHash(),
    ip_address: req.headers.get('x-forwarded-for') ?? null,
    user_agent: req.headers.get('user-agent') ?? null,
  });

  // 6. Enqueue pluggy.sync with per-user singleton key (D-41).
  //    singletonKey deduplicates in-flight jobs for the same user.
  //    pg-boss v12 uses singletonKey only (singletonHours removed in v12).
  await enqueue(
    QUEUES.PLUGGY_SYNC,
    { user_id: session.userId, item_id: inserted_id, trigger: 'first_connect' },
    { singletonKey: session.userId },
  );

  // 7. Audit log (D-13).
  await recordAudit({
    user_id: session.userId,
    action: 'item_connected',
    metadata: {
      connector_id: body.connector_id,
      institution_name: body.institution_name,
      cooldown_bypassed: false,
    },
    ip_address: req.headers.get('x-forwarded-for') ?? null,
    user_agent: req.headers.get('user-agent') ?? null,
  });

  // 8. Return 202 Accepted (D-07: sync is async, handler returns immediately).
  return NextResponse.json({ id: inserted_id }, { status: 202 });
}
