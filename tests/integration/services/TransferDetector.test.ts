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

/** Seed a transaction and return its id. Optional `explicit_id` for determinism tests. */
async function seedTransaction(
  user_id: string,
  account_id: string,
  amount: string,
  type: 'DEBIT' | 'CREDIT',
  posted_at: Date,
  explicit_id?: string,
): Promise<string> {
  const { db } = await import('@/db');
  const { transactions } = await import('@/db/schema');

  const [row] = await db
    .insert(transactions)
    .values({
      ...(explicit_id ? { id: explicit_id } : {}),
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

  // -------------------------------------------------------------------------
  // Plan 02-13 — Concern #4 closure: deterministic mutual best match.
  // -------------------------------------------------------------------------

  it('transfer-determinism-1: one debit + 3 credits same amount picks closest credit by time', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');
    const acct_b = await seedAccount(user_id, item_id, 'SAVINGS', 'b');
    const acct_c = await seedAccount(user_id, item_id, 'SAVINGS', 'c');

    const debit_at = new Date('2026-04-15T12:00:00Z');
    // C2 is 6h away from the debit — closest within the 3-day window.
    const c1_at = new Date('2026-04-14T12:00:00Z'); // 24h delta
    const c2_at = new Date('2026-04-15T18:00:00Z'); //  6h delta — closest
    const c3_at = new Date('2026-04-13T12:00:00Z'); // 48h delta

    const tx_d  = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT',  debit_at);
    const tx_c1 = await seedTransaction(user_id, acct_b, '500.00', 'CREDIT', c1_at);
    const tx_c2 = await seedTransaction(user_id, acct_b, '500.00', 'CREDIT', c2_at);
    const tx_c3 = await seedTransaction(user_id, acct_c, '500.00', 'CREDIT', c3_at);

    await transferDetectorWorker([
      { id: 'job-d1', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const rows = await db
      .select({ id: transactions.id, is_transfer: transactions.is_transfer, transfer_pair_id: transactions.transfer_pair_id })
      .from(transactions)
      .where(eq(transactions.user_id, user_id));
    const by_id = Object.fromEntries(rows.map((r) => [r.id, r]));

    // Debit and C2 form the only flagged pair (1-to-1 invariant).
    expect(by_id[tx_d].is_transfer).toBe(true);
    expect(by_id[tx_d].transfer_pair_id).toBe(tx_c2);
    expect(by_id[tx_c2].is_transfer).toBe(true);
    expect(by_id[tx_c2].transfer_pair_id).toBe(tx_d);

    // C1 and C3 must NOT be flagged — there is no debit left to pair with them.
    expect(by_id[tx_c1].is_transfer).toBe(false);
    expect(by_id[tx_c1].transfer_pair_id).toBeNull();
    expect(by_id[tx_c3].is_transfer).toBe(false);
    expect(by_id[tx_c3].transfer_pair_id).toBeNull();
  });

  it('transfer-determinism-2: id-lex tiebreak — equal time delta picks smallest id wins', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');
    const acct_b = await seedAccount(user_id, item_id, 'SAVINGS', 'b');
    const acct_c = await seedAccount(user_id, item_id, 'SAVINGS', 'c');

    const debit_at  = new Date('2026-04-15T12:00:00Z');
    const credit_at_alpha = new Date('2026-04-15T11:00:00Z'); // -1h
    const credit_at_beta  = new Date('2026-04-15T13:00:00Z'); // +1h (same |delta|)

    // Force a known id ordering: alpha lex-sorts before beta.
    const credit_alpha_id = '00000000-0000-0000-0000-000000000001';
    const credit_beta_id  = '00000000-0000-0000-0000-000000000002';

    const tx_d = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT',  debit_at);
    await seedTransaction(user_id, acct_b, '500.00', 'CREDIT', credit_at_alpha, credit_alpha_id);
    await seedTransaction(user_id, acct_c, '500.00', 'CREDIT', credit_at_beta,  credit_beta_id);

    await transferDetectorWorker([
      { id: 'job-d2', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [debit_row] = await db
      .select({ transfer_pair_id: transactions.transfer_pair_id })
      .from(transactions)
      .where(eq(transactions.id, tx_d));

    expect(debit_row.transfer_pair_id).toBe(credit_alpha_id);
  });

  it('transfer-determinism-3: re-run produces byte-identical transfer_pair_id assignments', async () => {
    const { db } = await import('@/db');
    const { transactions, audit_log } = await import('@/db/schema');
    const { transferDetectorWorker } = await import('@/jobs/workers/transferDetectorWorker');
    const { count } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);
    const acct_a = await seedAccount(user_id, item_id, 'CHECKING', 'a');
    const acct_b = await seedAccount(user_id, item_id, 'SAVINGS', 'b');
    const acct_c = await seedAccount(user_id, item_id, 'SAVINGS', 'c');

    const debit_at = new Date('2026-04-15T12:00:00Z');
    const c1_at = new Date('2026-04-14T12:00:00Z'); // 24h
    const c2_at = new Date('2026-04-15T18:00:00Z'); //  6h — closest
    const c3_at = new Date('2026-04-13T12:00:00Z'); // 48h

    const tx_d  = await seedTransaction(user_id, acct_a, '500.00', 'DEBIT',  debit_at);
    const tx_c1 = await seedTransaction(user_id, acct_b, '500.00', 'CREDIT', c1_at);
    const tx_c2 = await seedTransaction(user_id, acct_b, '500.00', 'CREDIT', c2_at);
    const tx_c3 = await seedTransaction(user_id, acct_c, '500.00', 'CREDIT', c3_at);

    const job = { id: 'job-d3', name: 'pluggy.transfer-detector', data: { user_id } } as Job<{ user_id: string }>;
    await transferDetectorWorker([job]);

    const rows_after_first = await db
      .select({ id: transactions.id, transfer_pair_id: transactions.transfer_pair_id })
      .from(transactions)
      .where(eq(transactions.user_id, user_id))
      .orderBy(transactions.id);

    // Insert an unrelated transaction that does NOT match the heuristic,
    // then re-run.
    const acct_d = await seedAccount(user_id, item_id, 'CHECKING', 'd');
    await seedTransaction(user_id, acct_d, '7.13', 'DEBIT', new Date('2026-01-01T00:00:00Z'));

    await transferDetectorWorker([job]);

    const rows_after_second = await db
      .select({ id: transactions.id, transfer_pair_id: transactions.transfer_pair_id })
      .from(transactions)
      .where(eq(transactions.user_id, user_id))
      .orderBy(transactions.id);

    // (a) Original four transactions retain their first-run pair assignments.
    const first_by_id  = Object.fromEntries(rows_after_first.map((r) => [r.id, r.transfer_pair_id]));
    const second_by_id = Object.fromEntries(rows_after_second.map((r) => [r.id, r.transfer_pair_id]));
    for (const id of [tx_d, tx_c1, tx_c2, tx_c3]) {
      expect(second_by_id[id]).toBe(first_by_id[id]);
    }

    // (b) Only one transfer_detected audit row — re-run produced no new pairs.
    const [{ value: audit_count }] = await db
      .select({ value: count() })
      .from(audit_log)
      .where(eq(audit_log.action, 'transfer_detected'));
    expect(Number(audit_count)).toBe(1);
  });
});

