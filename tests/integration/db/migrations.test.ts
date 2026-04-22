import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;

beforeAll(async () => {
  td = await startTestDb();
}, 120_000);

afterAll(async () => {
  await td.stop();
});

async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  } finally {
    await client.end();
  }
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function schemaSnapshot(url: string): Promise<ColumnRow[]> {
  const client = postgres(url, { max: 1 });
  try {
    const rows = await client<ColumnRow[]>`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `;
    return rows.map((r) => ({ ...r }));
  } finally {
    await client.end();
  }
}

describe('drizzle migrations', () => {
  it('migrate twice produces identical schema state', async () => {
    await runMigrations(td.url);
    const snap1 = await schemaSnapshot(td.url);
    await runMigrations(td.url);
    const snap2 = await schemaSnapshot(td.url);
    expect(snap2).toEqual(snap1);
  });

  it('creates pgcrypto extension', async () => {
    const client = postgres(td.url, { max: 1 });
    try {
      const rows = await client<{ extname: string }[]>`
        SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
      `;
      expect(rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('creates all 14 phase 1 tables', async () => {
    const client = postgres(td.url, { max: 1 });
    try {
      const rows = await client<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `;
      const table_names = rows.map((r) => r.table_name);
      const expected_tables = [
        'users',
        'sessions',
        'accounts_oauth',
        'verification_tokens',
        'user_consents',
        'audit_log',
        'admin_access_log',
        'webhook_events',
        'subscriptions',
        'dsr_requests',
        'auth_rate_limits',
        'account_locks',
        'password_reset_tokens',
        'ses_suppressions',
      ];
      for (const expected of expected_tables) {
        expect(table_names).toContain(expected);
      }
    } finally {
      await client.end();
    }
  });

  it('renames Auth.js accounts table to accounts_oauth (no `accounts` table)', async () => {
    const client = postgres(td.url, { max: 1 });
    try {
      const rows = await client<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts'
      `;
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('declares UNIQUE(source, event_id) on webhook_events', async () => {
    const client = postgres(td.url, { max: 1 });
    try {
      const rows = await client<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'webhook_events'
          AND indexname = 'webhook_events_source_event_unique'
      `;
      expect(rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
