/**
 * Pluggy webhook payload redaction.
 *
 * Closes 02-REVIEWS.md Concern #1 and pitfall P4.
 *
 * Roadmap success criterion #6: pluggy_item_id is NEVER visible in plaintext
 * in the database. The webhook receiver previously persisted the raw Pluggy
 * body (containing payload.itemId plaintext) into webhook_events.payload AND
 * enqueued payload.itemId verbatim into pg-boss job rows. Both are DB state —
 * both must be redacted at the boundary.
 *
 * This helper:
 *   1. Shallow-clones the payload (never mutates the caller's object).
 *   2. Removes the top-level `itemId` field if present.
 *   3. Adds `itemIdHash` = lower-hex of hashPluggyItemId(itemId) for forensic
 *      correlation. Auditors can re-derive the hash from the ciphertext stored
 *      in pluggy_items.pluggy_item_id_enc + the pepper.
 *
 * NON-GOALS for Phase 2:
 *   - Field-level scrub of nested error.message strings (Phase 6 widening).
 *   - Encryption of webhook_events.payload at rest (D-40 deferred to Phase 6).
 *
 * The retention + non-exposure + log-prohibition policy that complements this
 * redaction lives at docs/security/pluggy-payload-policy.md.
 */

import { hashPluggyItemId } from '@/lib/crypto';

export const REDACTED_ITEM_ID_KEY = 'itemIdHash';

export interface PluggyEventLike {
  event?: string;
  eventId?: string;
  itemId?: string;
  itemIdHash?: string;
  [k: string]: unknown;
}

export function redactPluggyPayload<T extends PluggyEventLike>(
  body: T,
): Omit<T, 'itemId'> & { [REDACTED_ITEM_ID_KEY]?: string } {
  // Shallow clone — never mutate the caller's object.
  const out: PluggyEventLike = { ...body };
  if (typeof body.itemId === 'string' && body.itemId.length > 0) {
    out[REDACTED_ITEM_ID_KEY] = hashPluggyItemId(body.itemId).toString('hex');
  }
  // Remove the plaintext itemId regardless of whether a hash was produced.
  delete out.itemId;
  return out as Omit<T, 'itemId'> & { [REDACTED_ITEM_ID_KEY]?: string };
}
