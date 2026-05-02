/**
 * Integration test — transferDetectorWorker.
 *
 * Plan 02-05 TDD — TX-04, D-33 deterministic 4-invariant SQL heuristic.
 *
 * Test scenarios:
 *   transfer-1: both legs flagged when all 4 D-33 invariants are met.
 *   transfer-2: no flag when amounts differ (negative — amount invariant).
 *   transfer-3: no flag when both transactions have same type (negative — type invariant).
 *   transfer-4: no flag when both transactions share the same account_id (negative — account invariant).
 *   transfer-5: no flag when posted_at is >3 days apart (negative — time invariant).
 *   transfer-6: idempotency — second run does NOT re-flag or create duplicate audit rows.
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16.
 *   - Apply Drizzle migrations.
 *   - Seed users, pluggy_items, accounts, transactions rows directly via Drizzle.
 *   - Invoke transferDetectorWorker directly (no pg-boss scheduler).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql, eq } from 'drizzle-orm';
import postgres from 'postgres';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

// ---------------------------------------------------------------------------
// DB + environment setup
// ---------------------------------------------------------------------------

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.CPF_HASH_PEPPER = 'td-test-pepper-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'td-item-pepper-at-least-32-chars-xxxx';
  process.env.NEXTAUTH_SECRET = 'td-test-secret-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'td-webhook-secret-at-least-32-chars-xx';
  process.env.BOSS_TEST_MODE = '1';

  pg = postgres(td.url, { max: 1 });
  const db_migrate = drizzle(pg);
  await db_migrate.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await migrate(db_migrate, { migrationsFolder: './src/db/migrations' });
}, 180_000);

afterAll(async () => {
  await pg.end();
  await td.stop();
});

// ---------------------------------------------------------------------------
// Helpers — seed data
// ---------------------------------------------------------------------------

/** Seed a minimal user row and return the user_id UUID. */
async function seedUser(): Promise<string> {
  const { db } = await import('@/db');
  const { users } = await import('@/db/schema');
  const { encryptCPF } = await import('@/lib/crypto');

  const cpf_enc = encryptCPF('123.456.789-09');
  const [row] = await db
    .insert(users)
    .values({
      email: `td-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password_hash: 'not-a-real-hash',
      cpf_enc,
      cpf_hash: Buffer.from('dummy-hash-for-tests-not-real-32b'),
    })
    .returning({ id: users.id });
  return row.id;
}

/** Seed a pluggy_items row and return its id. */
async function seedPluggyItem(user_id: string): Promise<string> {
  const { db } = await import('@/db');
  const { pluggy_items } = await import('@/db/schema');

  const pluggy_item_id_enc = Buffer.from('enc-fake-item-id');
  const pluggy_item_id_hash = Buffer.from('hash-fake-item-id-not-real-32byt');
  const [row] = await db
    .insert(pluggy_items)
    .values({
      user_id,
      pluggy_item_id_enc,
      pluggy_item_id_hash,
      connector_id: 'connector-123',
      institution_name: 'Itau',
      status: 'UPDATED',
    })
    .returning({ id: pluggy_items.id });
  return row.id;
}

/** Seed an account row and return its id. */
async function seedAccount(
  user_id: string,
  pluggy_item_id: string,
  type: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' = 'CHECKING',
  suffix: string = '',
): Promise<string> {
  const { db } = await import('@/db');
  const { accounts } = await import('@/db/schema');

  const [row] = await db
    .insert(accounts)
    .values({
      user_id,
      pluggy_item_id,
      pluggy_account_id: `acct-${Date.now()}-${suffix}`,
      type,
      name: `Test Account ${suffix}`,
      currency: 'BRL',
      balance: '0',
    })
    .returning({ id: accounts.id });
  return row.id;
}

/** Seed a transaction and return its id. */
async function seedTransaction(
  user_id: string,
  account_id: string,
  amount: string,
  type: 'DEBIT' | 'CREDIT',
  posted_at: Date,
): Promise<string> {
  const { db } = await import('@/db');
  const { transactions } = await import('@/db/schema');

  const [row] = await db
    .insert(transactions)
    .values({
      user_id,
      account_id,
      pluggy_transaction_id: `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      amount,
      currency: 'BRL',
      description: `Test transaction ${type}`,
      posted_at,
      status: 'POSTED',
      raw_payload: {},
    })
    .returning({ id: transactions.id });
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('transferDetectorWorker', () => {
  beforeEach(async () => {
    // Clear all tables between tests to ensure isolation
    const { db } = await import('@/db');
    const { transactions, accounts, pluggy_items, users, audit_log } = await import('@/db/schema');
    await db.delete(audit_log);
    await db.delete(transactions);
    await db.delete(accounts);
    await db.delete(pluggy_items);
    await db.delete(users);
  });

  it('transfer-1: flags both legs when all D-33 invariants are met', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');
    const acct_b = await seedAccount(user_id, item_id, 'SAVINGS', 'b');

    const base_date = new Date('2026-04-15T12:00:00Z');
    const one_day_later = new Date('2026-04-16T12:00:00Z');

    const tx_a = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT', base_date);
    const tx_b = await seedTransaction(user_id, acct_b, '500.00', 'CREDIT', one_day_later);

    await transferDetectorWorker([
      { id: 'job-t1', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row_a] = await db
      .select({ is_transfer: transactions.is_transfer, transfer_pair_id: transactions.transfer_pair_id })
      .from(transactions)
      .where(eq(transactions.id, tx_a));
    const [row_b] = await db
      .select({ is_transfer: transactions.is_transfer, transfer_pair_id: transactions.transfer_pair_id })
      .from(transactions)
      .where(eq(transactions.id, tx_b));

    // Both legs must be flagged
    expect(row_a.is_transfer).toBe(true);
    expect(row_b.is_transfer).toBe(true);
    // Both must link to the other
    expect(row_a.transfer_pair_id).toBe(tx_b);
    expect(row_b.transfer_pair_id).toBe(tx_a);
  });

  it('transfer-2: does NOT flag when amounts differ (500.00 vs 499.99)', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');
    const acct_b = await seedAccount(user_id, item_id, 'SAVINGS', 'b');

    const base_date = new Date('2026-04-15T12:00:00Z');
    const tx_a = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT', base_date);
    const tx_b = await seedTransaction(user_id, acct_b, '499.99', 'CREDIT', base_date);

    await transferDetectorWorker([
      { id: 'job-t2', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row_a] = await db
      .select({ is_transfer: transactions.is_transfer })
      .from(transactions)
      .where(eq(transactions.id, tx_a));
    const [row_b] = await db
      .select({ is_transfer: transactions.is_transfer })
      .from(transactions)
      .where(eq(transactions.id, tx_b));

    expect(row_a.is_transfer).toBe(false);
    expect(row_b.is_transfer).toBe(false);
  });

  it('transfer-3: does NOT flag when both transactions have the same type', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');
    const acct_b = await seedAccount(user_id, item_id, 'SAVINGS', 'b');

    const base_date = new Date('2026-04-15T12:00:00Z');
    const tx_a = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT', base_date);
    const tx_b = await seedTransaction(user_id, acct_b, '500.00', 'DEBIT', base_date);

    await transferDetectorWorker([
      { id: 'job-t3', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row_a] = await db
      .select({ is_transfer: transactions.is_transfer })
      .from(transactions)
      .where(eq(transactions.id, tx_a));

    expect(row_a.is_transfer).toBe(false);
  });

  it('transfer-4: does NOT flag when both transactions share the same account_id', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');

    const base_date = new Date('2026-04-15T12:00:00Z');
    const tx_a = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT', base_date);
    const tx_b = await seedTransaction(user_id, acct_a, '500.00', 'CREDIT', base_date);

    await transferDetectorWorker([
      { id: 'job-t4', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row_a] = await db
      .select({ is_transfer: transactions.is_transfer })
      .from(transactions)
      .where(eq(transactions.id, tx_a));

    expect(row_a.is_transfer).toBe(false);
  });

  it('transfer-5: does NOT flag when posted_at is more than 3 days apart', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');
    const acct_b = await seedAccount(user_id, item_id, 'SAVINGS', 'b');

    const base_date = new Date('2026-04-15T12:00:00Z');
    // 4 days apart — outside the 3-day window
    const four_days_later = new Date('2026-04-19T12:00:00Z');

    const tx_a = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT', base_date);
    const tx_b = await seedTransaction(user_id, acct_b, '500.00', 'CREDIT', four_days_later);

    await transferDetectorWorker([
      { id: 'job-t5', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row_a] = await db
      .select({ is_transfer: transactions.is_transfer })
      .from(transactions)
      .where(eq(transactions.id, tx_a));

    expect(row_a.is_transfer).toBe(false);
  });

  it('transfer-6: idempotent — second run does not re-flag or create duplicate audit rows', async () => {
    const { db } = await import('@/db');
    const { transactions, audit_log } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');
    const { eq: drizzleEq, count } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');
    const acct_b = await seedAccount(user_id, item_id, 'SAVINGS', 'b');

    const base_date = new Date('2026-04-15T12:00:00Z');
    const one_day_later = new Date('2026-04-16T12:00:00Z');

    const tx_a = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT', base_date);
    await seedTransaction(user_id, acct_b, '500.00', 'CREDIT', one_day_later);

    const job = { id: 'job-t6', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>;

    // Run twice
    await transferDetectorWorker([job]);
    const [row_before] = await db
      .select({ updated_at: transactions.updated_at })
      .from(transactions)
      .where(drizzleEq(transactions.id, tx_a));

    // Wait a tiny bit so updated_at would change if re-flagged
    await new Promise((r) => setTimeout(r, 50));
    await transferDetectorWorker([job]);

    const [row_after] = await db
      .select({ updated_at: transactions.updated_at, is_transfer: transactions.is_transfer })
      .from(transactions)
      .where(drizzleEq(transactions.id, tx_a));

    // Still flagged but updated_at NOT changed on second run (no-op)
    expect(row_after.is_transfer).toBe(true);
    // updated_at should not have advanced on the second run
    expect(row_after.updated_at.getTime()).toBe(row_before.updated_at.getTime());

    // Only 1 audit row for transfer_detected (not 2)
    const [{ value: audit_count }] = await db
      .select({ value: count() })
      .from(audit_log)
      .where(drizzleEq(audit_log.action, 'transfer_detected'));
    expect(Number(audit_count)).toBe(1);
  });
});
