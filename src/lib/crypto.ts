/**
 * AES-256-GCM CPF encryption + HMAC-SHA-256 CPF uniqueness hash.
 *
 * RESEARCH.md § Plan slice 01-02 item 4 / Pitfall P28.
 *
 * - `encryptCPF` produces `iv (12) || tag (16) || ciphertext (N)` — a
 *   single Buffer suitable for the `users.cpf_enc` bytea column.
 * - `decryptCPF` reverses the layout and verifies the AES-GCM auth tag.
 *   Tampering raises during `decipher.final()`.
 * - `hashCPF` is a deterministic HMAC-SHA-256 over the CPF using
 *   `env.CPF_HASH_PEPPER` (DISTINCT from `env.ENCRYPTION_KEY`). Used as
 *   the lookup key for the `users.cpf_hash` partial unique index.
 *
 * All three functions ONLY accept already-validated CPFs (caller must
 * have run them through `CPFSchema` first). Never log the inputs or
 * outputs of these functions.
 *
 * SECURITY: `assertServerOnly()` (called below) replaces the previous
 * `import 'server-only';` (plan 02-07). The package import moved to
 * `@/lib/serverOnly.ts` so plain Node / tsx callers (worker boot,
 * db:migrate, e2e runner) can load this module without the package's
 * CJS-mode throw firing. The compile-time client-bundle guard is still
 * preserved at the leaf via `serverOnly.ts`'s own `import 'server-only';`.
 * See plan 02-10.
 */
import { assertServerOnly } from '@/lib/serverOnly';

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { env } from '@/lib/env';

assertServerOnly();

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'base64');
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptCPF(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptCPF(blob: Buffer): string {
  if (blob.byteLength < IV_BYTES + TAG_BYTES) {
    throw new Error('decryptCPF: blob too short');
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    'utf8',
  );
}

export function hashCPF(plaintext: string): Buffer {
  return createHmac('sha256', env.CPF_HASH_PEPPER).update(plaintext).digest();
}

/**
 * Mirror of hashCPF() shape — distinct pepper for defense-in-depth.
 *
 * RESEARCH.md OQ#6 RESOLVED: Phase 2 uses a SEPARATE pepper
 * (PLUGGY_ITEM_ID_HASH_PEPPER) so that a database leak of one hash set
 * cannot be used to reverse-engineer the other. Do NOT substitute bare
 * createHash('sha256') — bare SHA-256 of a Pluggy itemId string is
 * trivially pre-imageable without a pepper.
 *
 * Used everywhere a pluggy_item_id needs a deterministic uniqueness lookup
 * (pluggy_items.pluggy_item_id_hash bytea column).
 *
 * NEVER log the plaintext input or the resulting Buffer.
 */
export function hashPluggyItemId(plaintext: string): Buffer {
  const pepper = env.PLUGGY_ITEM_ID_HASH_PEPPER;
  if (!pepper) {
    throw new Error(
      'PLUGGY_ITEM_ID_HASH_PEPPER missing — required for hashPluggyItemId(). ' +
      'Set min-32-char value in env (mirrors CPF_HASH_PEPPER pattern).',
    );
  }
  return createHmac('sha256', Buffer.from(pepper, 'utf8')).update(plaintext).digest();
}
