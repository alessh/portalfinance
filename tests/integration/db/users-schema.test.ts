import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;

beforeAll(async () => {
  td = await startTestDb();
  const client = postgres(td.url, { max: 1 });
  try {
    const db = drizzle(client);
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  } finally {
    await client.end();
  }
}, 120_000);

afterAll(async () => {
  await td.stop();
});

describe('users schema', () => {
  it('inserts a user without CPF and subscription_tier defaults to paid', async () => {
    const client = postgres(td.url, { max: 1 });
    try {
      const rows = await client<
        {
          id: string;
          subscription_tier: string;
          cpf_hash: Buffer | null;
          cpf_enc: Buffer | null;
          deleted_at: Date | null;
        }[]
      >`
        INSERT INTO users (email, password_hash)
        VALUES ('t1@example.com', 'x')
        RETURNING id, subscription_tier, cpf_hash, cpf_enc, deleted_at
      `;
      const row = rows[0];
      expect(row.subscription_tier).toBe('paid');
      expect(row.cpf_hash).toBeNull();
      expect(row.cpf_enc).toBeNull();
      expect(row.deleted_at).toBeNull();
    } finally {
      await client.end();
    }
  });

  it('enforces email UNIQUE', async () => {
    const client = postgres(td.url, { max: 1 });
    try {
      await client`INSERT INTO users (email, password_hash) VALUES ('uniq@example.com', 'x')`;
      await expect(
        client`INSERT INTO users (email, password_hash) VALUES ('uniq@example.com', 'y')`,
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('allows multiple users with NULL cpf_hash (partial unique index)', async () => {
    const client = postgres(td.url, { max: 1 });
    try {
      await client`INSERT INTO users (email, password_hash) VALUES ('null-cpf-a@example.com', 'x')`;
      await client`INSERT INTO users (email, password_hash) VALUES ('null-cpf-b@example.com', 'x')`;
      const rows = await client<{ id: string }[]>`
        SELECT id FROM users WHERE cpf_hash IS NULL
      `;
      expect(rows.length).toBeGreaterThanOrEqual(2);
    } finally {
      await client.end();
    }
  });

  it('rejects duplicate non-null cpf_hash via partial unique index', async () => {
    const client = postgres(td.url, { max: 1 });
    try {
      const cpf_hash = Buffer.from('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'utf8'); // 32 bytes
      await client`
        INSERT INTO users (email, password_hash, cpf_hash)
        VALUES ('cpf-a@example.com', 'x', ${cpf_hash})
      `;
      await expect(
        client`
          INSERT INTO users (email, password_hash, cpf_hash)
          VALUES ('cpf-b@example.com', 'y', ${cpf_hash})
        `,
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });
});
