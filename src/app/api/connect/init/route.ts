export const runtime = 'nodejs';
/**
 * POST /api/connect/init — consent gate + CPF capture + Pluggy connect token issuance.
 *
 * Plan 02-03 / CONTEXT.md D-02, D-06, D-08, D-10.
 *
 * Step sequence (D-08):
 *   1. requireSession — 401 on failure.
 *   2. Validate body: granted=true required, cpf optional.
 *   3. If user does not have a real CPF on file: require cpf, validate (CPFSchema), encrypt + hash,
 *      UPDATE users. On invalid CPF: return 400 INVALID_CPF with ZERO DB writes, ZERO PluggyService
 *      calls (D-06).
 *   4. INSERT user_consents row with scope='PLUGGY_CONNECT_PENDING' (pre-widget, D-08 step 1).
 *   5. If reconnect_item_id provided: load pluggy_items row + IDOR check (P26); 404 not 403 on miss.
 *   6. Call PluggyService.createConnectToken → return { connect_token }.
 *
 * CPF detection note:
 *   Plan 02-01 signupCore writes randomBytes(44) as cpf_enc placeholder.
 *   encryptCPF("12345678901") → 12(iv)+16(tag)+11(cpf) = 39 bytes.
 *   So: cpf_enc.byteLength === 44 → user has ONLY the signup placeholder → needs real CPF.
 *   cpf_enc.byteLength === 39 → user set a real CPF at a previous connect.
 *
 * SECURITY:
 *   - CPF never logged (P13, P28).
 *   - Pluggy item ID decrypted inside PluggyService only (P4).
 *   - reconnect_item_id filtered by user_id (P26 IDOR guard, returns 404 not 403).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, user_consents, pluggy_items } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { CPFSchema } from '@/lib/cpf';
import { encryptAndHashCPF } from '@/lib/cpfServer';
import { getPluggyConsentVersionHash } from '@/lib/consentVersions';
import { getPluggyService } from '@/services/PluggyService';

const Body = z.object({
  cpf: z.string().optional(),
  granted: z.literal(true),
  reconnect_item_id: z.string().uuid().optional(),
});

export async function POST(req: Request): Promise<Response> {
  // 1. Session gate — throws UnauthorizedError → 401.
  const session = await requireSession(req);

  // 2. Parse + validate body.
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  // 3. CPF requirement — detect whether user already has a real CPF.
  //    signup placeholder = 44 random bytes; real AES-GCM CPF enc = 39 bytes.
  const userRows = await db
    .select({ cpf_enc: users.cpf_enc })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const user = userRows[0];
  if (!user) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const has_cpf = user.cpf_enc && (user.cpf_enc as Buffer).byteLength !== 44;

  if (!has_cpf) {
    if (!body.cpf) {
      return NextResponse.json({ error: 'CPF_REQUIRED' }, { status: 400 });
    }
    // Client-side already ran CPFSchema — server re-validates (D-06).
    const parsed = CPFSchema.safeParse(body.cpf);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_CPF' }, { status: 400 });
    }
    // Encrypt + hash and persist (P28). No logging of plaintext CPF (P13).
    const { cpf_enc, cpf_hash } = encryptAndHashCPF(parsed.data);
    await db.update(users).set({ cpf_hash, cpf_enc }).where(eq(users.id, session.userId));
  }

  // 4. Pre-widget consent row (D-08 step 1): scope='PLUGGY_CONNECT_PENDING'.
  await db.insert(user_consents).values({
    user_id: session.userId,
    scope: 'PLUGGY_CONNECT_PENDING',
    action: 'GRANTED',
    consent_version: getPluggyConsentVersionHash(),
    ip_address: req.headers.get('x-forwarded-for') ?? null,
    user_agent: req.headers.get('user-agent') ?? null,
  });

  // 5. Reconnect path: load + IDOR-check the item (D-12, P26).
  let reconnect_item_id_enc: Buffer | undefined;
  if (body.reconnect_item_id) {
    const itemRows = await db
      .select({ pluggy_item_id_enc: pluggy_items.pluggy_item_id_enc, user_id: pluggy_items.user_id })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, body.reconnect_item_id))
      .limit(1);

    if (!itemRows[0] || itemRows[0].user_id !== session.userId) {
      // 404 not 403 — leaking row existence is itself a privacy violation (P26).
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    reconnect_item_id_enc = itemRows[0].pluggy_item_id_enc as Buffer;
  }

  // 6. Issue Pluggy connect token — SDK call, no plaintext item ID outside PluggyService (P4).
  const { connect_token } = await getPluggyService().createConnectToken({
    user_id: session.userId,
    reconnect_item_id_enc,
  });

  return NextResponse.json({ connect_token });
}
