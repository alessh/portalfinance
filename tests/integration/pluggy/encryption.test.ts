/**
 * Integration test — pluggy_item_id at-rest encryption (CONN-07, T-02-C).
 *
 * Plan 02-02 — Proves that:
 *   (a) pluggy_item_id_enc stored in pluggy_items is a Buffer of length > 28
 *       (12 IV + 16 GCM tag + at least 1 ciphertext byte).
 *   (b) The ciphertext bytes do NOT contain the ASCII bytes of the plaintext.
 *   (c) decryptCPF(row.pluggy_item_id_enc) returns the original plaintext.
 *   (d) Two separate writes of the same plaintext produce different ciphertexts
 *       (random IV per write — CBC reuse attack mitigation).
 *
 * Strategy:
 *   - Spin up a testcontainers Postgres 16 instance.
 *   - Apply the project Drizzle migrations (schema must include pluggy_items).
 *   - Write rows via raw SQL (no Drizzle ORM overhead) — isolates the crypto layer.
 *   - Read back and assert ciphertext properties.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../../fixtures/db';
import { encryptCPF, decryptCPF } from '@/lib/crypto';

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let td: TestDb;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
  process.env.CPF_HASH_PEPPER = 'enc-test-pepper-at-least-32-chars-xxxxx';
  process.env.NEXTAUTH_SECRET = 'enc-test-secret-at-least-32-chars-xxxxxx';
  // PLUGGY_ITEM_ID_HASH_PEPPER is optional in test env (not production).
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'enc-test-pluggy-pepper-32-chars-xxxxxx';

  client = postgres(td.url, { max: 1 });
  const db = drizzle(client);

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await migrate(db, { migrationsFolder: './src/db/migrations' });
}, 180_000);

afterAll(async () => {
  await client.end();
  await td.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAINTEXT_ITEM_ID = 'item-abc-123';

/**
 * Insert a pluggy_items row directly via raw SQL.
 * Uses encryptCPF (generic AES-256-GCM) for pluggy_item_id_enc and a
 * fixed hash buffer for pluggy_item_id_hash. The user_id FK is satisfied
 * via a temporary user row.
 */
async function insertItemRow(itemIdEnc: Buffer): Promise<string> {
  // Insert a minimal user row first (required by FK constraint).
  // Uses actual schema columns from src/db/schema/users.ts — no email_normalized.
  const userResult = await client`
    INSERT INTO users (
      id, email,
      password_hash,
      cpf_hash, cpf_enc,
      created_at
    ) VALUES (
      gen_random_uuid(),
      ${'enc-test-' + Date.now() + '-' + Math.random() + '@example.com'},
      'argon2id-placeholder-hash',
      ${randomBytes(32)},
      ${randomBytes(44)},
      NOW()
    )
    RETURNING id
  `;
  const userId = userResult[0].id as string;

  // Insert pluggy_items row with the provided encrypted item ID.
  const itemResult = await client`
    INSERT INTO pluggy_items (
      id, user_id,
      pluggy_item_id_enc, pluggy_item_id_hash,
      connector_id, institution_name,
      status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${userId},
      ${itemIdEnc}, ${Buffer.alloc(32, 5)},
      '201', 'Banco Teste',
      'UPDATED', NOW(), NOW()
    )
    RETURNING id
  `;
  return itemResult[0].id as string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pluggy_items — pluggy_item_id_enc at-rest encryption', () => {
  it('(a) stored ciphertext has length > 28 (IV + tag + at least 1 byte)', async () => {
    const enc = encryptCPF(PLAINTEXT_ITEM_ID);
    const rowId = await insertItemRow(enc);

    const [row] = await client`
      SELECT pluggy_item_id_enc FROM pluggy_items WHERE id = ${rowId}
    `;
    const stored = row.pluggy_item_id_enc as Buffer;
    // 12 (IV) + 16 (GCM tag) + len(PLAINTEXT_ITEM_ID) bytes
    expect(stored.byteLength).toBeGreaterThan(28);
  });

  it('(b) stored ciphertext bytes do NOT contain plaintext ASCII', async () => {
    const enc = encryptCPF(PLAINTEXT_ITEM_ID);
    const rowId = await insertItemRow(enc);

    const [row] = await client`
      SELECT pluggy_item_id_enc FROM pluggy_items WHERE id = ${rowId}
    `;
    const stored = row.pluggy_item_id_enc as Buffer;
    const plaintextBytes = Buffer.from(PLAINTEXT_ITEM_ID, 'utf8');

    // Ciphertext must not contain the plaintext as a contiguous subsequence.
    // Simple check: convert both to hex and verify plaintext hex not present.
    const storedHex = stored.toString('hex');
    const plaintextHex = plaintextBytes.toString('hex');
    expect(storedHex).not.toContain(plaintextHex);
  });

  it('(c) decryptCPF(stored_enc) returns the original plaintext', async () => {
    const enc = encryptCPF(PLAINTEXT_ITEM_ID);
    const rowId = await insertItemRow(enc);

    const [row] = await client`
      SELECT pluggy_item_id_enc FROM pluggy_items WHERE id = ${rowId}
    `;
    const stored = row.pluggy_item_id_enc as Buffer;
    expect(decryptCPF(stored)).toBe(PLAINTEXT_ITEM_ID);
  });

  it('(d) two writes of the same plaintext produce different ciphertexts (random IV)', async () => {
    const enc1 = encryptCPF(PLAINTEXT_ITEM_ID);
    const enc2 = encryptCPF(PLAINTEXT_ITEM_ID);

    const rowId1 = await insertItemRow(enc1);
    const rowId2 = await insertItemRow(enc2);

    const [row1] = await client`
      SELECT pluggy_item_id_enc FROM pluggy_items WHERE id = ${rowId1}
    `;
    const [row2] = await client`
      SELECT pluggy_item_id_enc FROM pluggy_items WHERE id = ${rowId2}
    `;

    const stored1 = row1.pluggy_item_id_enc as Buffer;
    const stored2 = row2.pluggy_item_id_enc as Buffer;

    // Different ciphertexts for the same plaintext (different IVs).
    expect(Buffer.compare(stored1, stored2)).not.toBe(0);

    // But both decrypt to the same plaintext.
    expect(decryptCPF(stored1)).toBe(PLAINTEXT_ITEM_ID);
    expect(decryptCPF(stored2)).toBe(PLAINTEXT_ITEM_ID);
  });
});
