/**
 * Integration test — faturaDetectorWorker.
 *
 * Plan 02-05 TDD — TX-05, Pitfall P8 credit-card fatura payment detection.
 *
 * Test scenarios:
 *   fatura-1: checking-account DEBIT matches credit-card balance within +/-7-day window → flagged.
 *   fatura-2: amount mismatch → no flag.
 *   fatura-3: idempotency — second run does not re-flag or create duplicate audit rows.
 *   fatura-4: outside +/-7-day proximity window (debit posted 26 days after cc updated_at) → no flag.
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16.
 *   - Apply Drizzle migrations.
 *   - Seed users, pluggy_items, accounts, transactions rows directly via Drizzle.
 *   - Invoke faturaDetectorWorker directly (no pg-boss scheduler).
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
import { sql, count } from 'drizzle-orm';
import postgres from 'postgres';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

// ---------------------------------------------------------------------------
// DB + environment setup
// ---------------------------------------------------------------------------

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.CPF_HASH_PEPPER = 'fd-test-pepper-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'fd-item-pepper-at-least-32-chars-xxxx';
  process.env.NEXTAUTH_SECRET = 'fd-test-secret-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'fd-webhook-secret-at-least-32-chars-xx';
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

async function seedUser(): Promise<string> {
  const { db } = await import('@/db');
  const { users } = await import('@/db/schema');
  const { encryptCPF } = await import('@/lib/crypto');

  const cpf_enc = encryptCPF('123.456.789-09');
  const [row] = await db
    .insert(users)
    .values({
      email: `fd-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password_hash: 'not-a-real-hash',
      cpf_enc,
      cpf_hash: Buffer.from('dummy-hash-for-tests-not-real-32b'),
    })
    .returning({ id: users.id });
  return row.id;
}

async function seedPluggyItem(user_id: string): Promise<string> {
  const { db } = await import('@/db');
  const { pluggy_items } = await import('@/db/schema');

  const pluggy_item_id_enc = Buffer.from('enc-fake-item-id-fd');
  const pluggy_item_id_hash = Buffer.from('hash-fake-item-id-fd-not-real-32b');
  const [row] = await db
    .insert(pluggy_items)
    .values({
      user_id,
      pluggy_item_id_enc,
      pluggy_item_id_hash,
      connector_id: 'connector-456',
      institution_name: 'Nubank',
      status: 'UPDATED',
    })
    .returning({ id: pluggy_items.id });
  return row.id;
}

/** Seed an account with a custom updated_at (for the credit-card billing cycle proxy). */
async function seedAccountWithUpdatedAt(
  user_id: string,
  pluggy_item_id: string,
  type: 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD',
  balance: string,
  updated_at: Date,
  suffix: string = '',
): Promise<string> {
  const { db } = await import('@/db');
  const { accounts } = await import('@/db/schema');

  // Insert then manually update updated_at (Drizzle defaultNow() cannot be overridden at insert)
  const [row] = await db
    .insert(accounts)
    .values({
      user_id,
      pluggy_item_id,
      pluggy_account_id: `acct-fd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${suffix}`,
      type,
      name: `FD Account ${type} ${suffix}`,
      currency: 'BRL',
      balance,
    })
    .returning({ id: accounts.id });

  await db.execute(
    sql`UPDATE accounts SET updated_at = ${updated_at.toISOString()} WHERE id = ${row.id}`,
  );

  return row.id;
}

/**
 * Seed an account with both updated_at and an explicit bill_due_date — used by
 * Plan 02-14 (Concern #5) tests to exercise the anchor-source preference path.
 * Pass bill_due_date=null to seed an account whose proximity anchor falls back
 * to accounts.updated_at.
 */
async function seedCreditCardWithBillDate(
  user_id: string,
  pluggy_item_id: string,
  balance: string,
  updated_at: Date,
  bill_due_date: Date | null,
  suffix: string = '',
): Promise<string> {
  const { db } = await import('@/db');
  const { accounts } = await import('@/db/schema');

  const [row] = await db
    .insert(accounts)
    .values({
      user_id,
      pluggy_item_id,
      pluggy_account_id: `acct-fd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${suffix}`,
      type: 'CREDIT_CARD',
      name: `FD CC ${suffix}`,
      currency: 'BRL',
      balance,
      bill_due_date,
    })
    .returning({ id: accounts.id });

  await db.execute(
    sql`UPDATE accounts SET updated_at = ${updated_at.toISOString()} WHERE id = ${row.id}`,
  );

  return row.id;
}

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
      pluggy_transaction_id: `tx-fd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      amount,
      currency: 'BRL',
      description: `Test fatura transaction ${type}`,
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

describe('faturaDetectorWorker', () => {
  beforeEach(async () => {
    const { db } = await import('@/db');
    const { transactions, accounts, pluggy_items, users, audit_log } = await import('@/db/schema');
    await db.delete(audit_log);
    await db.delete(transactions);
    await db.delete(accounts);
    await db.delete(pluggy_items);
    await db.delete(users);
  });

  it('fatura-1: flags checking DEBIT matching credit-card balance within +/-7-day window', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    // Checking account — DEBIT posted 2026-04-15
    const checking_posted_at = new Date('2026-04-15T12:00:00Z');
    const checking_acct = await seedAccountWithUpdatedAt(
      user_id,
      item_id,
      'CHECKING',
      '0',
      new Date('2026-04-01T00:00:00Z'),
      'chk',
    );

    // Credit-card account — balance 890.00, updated_at 2026-04-12 (3 days before the debit, within +/-7 days)
    const cc_updated_at = new Date('2026-04-12T12:00:00Z');
    await seedAccountWithUpdatedAt(user_id, item_id, 'CREDIT_CARD', '890.00', cc_updated_at, 'cc');

    // Seed the checking DEBIT that should be flagged
    const tx_id = await seedTransaction(user_id, checking_acct, '890.00', 'DEBIT', checking_posted_at);

    await faturaDetectorWorker([
      { id: 'job-f1', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    expect(row.is_credit_card_payment).toBe(true);
  });

  it('fatura-2: does NOT flag when debit amount does not match credit-card balance', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id,
      item_id,
      'CHECKING',
      '0',
      new Date('2026-04-01T00:00:00Z'),
      'chk',
    );
    const cc_updated_at = new Date('2026-04-12T12:00:00Z');
    await seedAccountWithUpdatedAt(user_id, item_id, 'CREDIT_CARD', '890.00', cc_updated_at, 'cc');

    // Amount mismatch: debit 100.00 vs cc balance 890.00
    const tx_id = await seedTransaction(
      user_id,
      checking_acct,
      '100.00',
      'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    await faturaDetectorWorker([
      { id: 'job-f2', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    expect(row.is_credit_card_payment).toBe(false);
  });

  it('fatura-3: idempotent — second run does not re-flag or create duplicate audit rows', async () => {
    const { db } = await import('@/db');
    const { transactions, audit_log } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id,
      item_id,
      'CHECKING',
      '0',
      new Date('2026-04-01T00:00:00Z'),
      'chk',
    );
    const cc_updated_at = new Date('2026-04-12T12:00:00Z');
    await seedAccountWithUpdatedAt(user_id, item_id, 'CREDIT_CARD', '890.00', cc_updated_at, 'cc');

    const tx_id = await seedTransaction(
      user_id,
      checking_acct,
      '890.00',
      'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    const job = {
      id: 'job-f3',
      name: 'pluggy.fatura-detector',
      data: { user_id },
    } as Job<{ user_id: string }>;

    // Run twice
    await faturaDetectorWorker([job]);
    const [row_before] = await db
      .select({ updated_at: transactions.updated_at })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    await new Promise((r) => setTimeout(r, 50));
    await faturaDetectorWorker([job]);

    const [row_after] = await db
      .select({ updated_at: transactions.updated_at, is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    // Still flagged but no change on second run
    expect(row_after.is_credit_card_payment).toBe(true);
    expect(row_after.updated_at.getTime()).toBe(row_before.updated_at.getTime());

    // Only 1 audit row for fatura_detected
    const [{ value: audit_count }] = await db
      .select({ value: count() })
      .from(audit_log)
      .where(eq(audit_log.action, 'fatura_detected'));
    expect(Number(audit_count)).toBe(1);
  });

  it('fatura-4: does NOT flag when posted_at is outside +/-7-day proximity window (26 days apart)', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id,
      item_id,
      'CHECKING',
      '0',
      new Date('2026-04-01T00:00:00Z'),
      'chk',
    );

    // Credit-card updated_at 2026-03-20 — 26 days before the debit posted_at (outside +/-7d)
    const cc_updated_at = new Date('2026-03-20T12:00:00Z');
    await seedAccountWithUpdatedAt(user_id, item_id, 'CREDIT_CARD', '890.00', cc_updated_at, 'cc');

    // Debit posted 2026-04-15 — 26 days after cc updated_at
    const tx_id = await seedTransaction(
      user_id,
      checking_acct,
      '890.00',
      'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    await faturaDetectorWorker([
      { id: 'job-f4', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    // Must NOT be flagged — 26 days is outside the +/-7-day window (P8 / TX-05)
    expect(row.is_credit_card_payment).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Plan 02-14 — Concern #5 closure: false-positive coverage + anchor source
  // -------------------------------------------------------------------------

  it('fatura-fp-1: same-amount purchase to non-card account (residual FP — still flags, documented)', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    // User has a checking account, savings (with same-amount CREDIT not flagged
    // as transfer because is_transfer is detector-managed), and a credit card.
    // Without independent context, a single 890 debit to the merchant + a card
    // with balance 890 will still be flagged. This test pins that documented
    // residual false-positive behavior so future changes that silently broaden
    // coverage are caught.
    const checking_acct = await seedAccountWithUpdatedAt(
      user_id, item_id, 'CHECKING', '0',
      new Date('2026-04-01T00:00:00Z'), 'fp1-chk',
    );
    await seedAccountWithUpdatedAt(
      user_id, item_id, 'CREDIT_CARD', '890.00',
      new Date('2026-04-12T12:00:00Z'), 'fp1-cc',
    );

    const tx_id = await seedTransaction(
      user_id, checking_acct, '890.00', 'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    await faturaDetectorWorker([
      { id: 'job-fp1', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    // Documented residual FP class #1 in docs/specs/fatura-detection.md.
    expect(row.is_credit_card_payment).toBe(true);
  });

  it('fatura-fp-2: pre-flagged transfer is excluded by detector (TransferDetector runs first)', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id, item_id, 'CHECKING', '0',
      new Date('2026-04-01T00:00:00Z'), 'fp2-chk',
    );
    await seedAccountWithUpdatedAt(
      user_id, item_id, 'CREDIT_CARD', '890.00',
      new Date('2026-04-12T12:00:00Z'), 'fp2-cc',
    );

    const tx_id = await seedTransaction(
      user_id, checking_acct, '890.00', 'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    // Simulate TransferDetector having already flagged this debit as a transfer
    // (the post-ingestion ordering is TransferDetector → FaturaDetector per
    // Wave 4 / 02-05 plan). FaturaDetector must skip rows where is_transfer=true.
    await db.execute(
      sql`UPDATE transactions SET is_transfer = true WHERE id = ${tx_id}`,
    );

    await faturaDetectorWorker([
      { id: 'job-fp2', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({
        is_credit_card_payment: transactions.is_credit_card_payment,
        is_transfer: transactions.is_transfer,
      })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    expect(row.is_transfer).toBe(true);
    expect(row.is_credit_card_payment).toBe(false);
  });

  it('fatura-fp-3: partial card payment (debit < card balance) is NOT flagged', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id, item_id, 'CHECKING', '0',
      new Date('2026-04-01T00:00:00Z'), 'fp3-chk',
    );
    await seedAccountWithUpdatedAt(
      user_id, item_id, 'CREDIT_CARD', '890.00',
      new Date('2026-04-12T12:00:00Z'), 'fp3-cc',
    );

    // Partial payment: debit 500.00, card balance 890.00 → no balance equality.
    const tx_id = await seedTransaction(
      user_id, checking_acct, '500.00', 'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    await faturaDetectorWorker([
      { id: 'job-fp3', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    expect(row.is_credit_card_payment).toBe(false);
  });

  it('fatura-fp-4: overpayment (debit > card balance) is NOT flagged', async () => {
    const { db } = await import('@/db');
    const { transactions } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id, item_id, 'CHECKING', '0',
      new Date('2026-04-01T00:00:00Z'), 'fp4-chk',
    );
    await seedAccountWithUpdatedAt(
      user_id, item_id, 'CREDIT_CARD', '890.00',
      new Date('2026-04-12T12:00:00Z'), 'fp4-cc',
    );

    // Overpayment: debit 1000.00 vs balance 890.00 → no balance equality.
    const tx_id = await seedTransaction(
      user_id, checking_acct, '1000.00', 'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    await faturaDetectorWorker([
      { id: 'job-fp4', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    expect(row.is_credit_card_payment).toBe(false);
  });

  it('fatura-fp-5: multi-card ambiguity — two cards with matching balance → NO flag (audit metadata records skip)', async () => {
    const { db } = await import('@/db');
    const { transactions, audit_log } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id, item_id, 'CHECKING', '0',
      new Date('2026-04-01T00:00:00Z'), 'fp5-chk',
    );
    // TWO credit cards both with balance 890 within the +/-7-day window —
    // ambiguous which one the debit settles. Multi-card guard MUST suppress.
    await seedAccountWithUpdatedAt(
      user_id, item_id, 'CREDIT_CARD', '890.00',
      new Date('2026-04-12T12:00:00Z'), 'fp5-cc-a',
    );
    await seedAccountWithUpdatedAt(
      user_id, item_id, 'CREDIT_CARD', '890.00',
      new Date('2026-04-13T12:00:00Z'), 'fp5-cc-b',
    );

    const tx_id = await seedTransaction(
      user_id, checking_acct, '890.00', 'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    await faturaDetectorWorker([
      { id: 'job-fp5', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    // Multi-card ambiguity → no auto-flag (Concern #5).
    expect(row.is_credit_card_payment).toBe(false);

    // No fatura_detected audit row (count was 0 → guard at flagged>0).
    const [{ value: detected_count }] = await db
      .select({ value: count() })
      .from(audit_log)
      .where(eq(audit_log.action, 'fatura_detected'));
    expect(Number(detected_count)).toBe(0);
  });

  it('fatura-billdate-anchor: prefers Pluggy bill_due_date when present (updated_at outside window)', async () => {
    const { db } = await import('@/db');
    const { transactions, audit_log } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id, item_id, 'CHECKING', '0',
      new Date('2026-04-01T00:00:00Z'), 'ba-chk',
    );

    // bill_due_date = 2026-04-15 (matches debit date) but accounts.updated_at
    // is 2026-03-01 (way outside the +/-7d window from updated_at).
    // Old heuristic would NOT flag (out-of-window). New heuristic prefers
    // bill_due_date and FLAGS.
    await seedCreditCardWithBillDate(
      user_id,
      item_id,
      '890.00',
      new Date('2026-03-01T00:00:00Z'),   // updated_at — far in the past
      new Date('2026-04-15T00:00:00Z'),   // bill_due_date — matches debit
      'ba-cc',
    );

    const tx_id = await seedTransaction(
      user_id, checking_acct, '890.00', 'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    await faturaDetectorWorker([
      { id: 'job-ba', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    expect(row.is_credit_card_payment).toBe(true);

    // Audit metadata records the anchor source.
    const [audit_row] = await db
      .select({ metadata: audit_log.metadata })
      .from(audit_log)
      .where(eq(audit_log.action, 'fatura_detected'));
    expect(audit_row).toBeDefined();
    const metadata = audit_row.metadata as Record<string, unknown>;
    expect(metadata.anchor_billdate).toBe(1);
    expect(metadata.anchor_fallback).toBe(0);
    expect(metadata.best_effort).toBe(true);
  });

  it('fatura-fallback-anchor: falls back to accounts.updated_at when bill_due_date IS NULL', async () => {
    const { db } = await import('@/db');
    const { transactions, audit_log } = await import('@/db/schema');
    const { faturaDetectorWorker } = await import('@/jobs/workers/faturaDetectorWorker');
    const { eq } = await import('drizzle-orm');

    const user_id = await seedUser();
    const item_id = await seedPluggyItem(user_id);

    const checking_acct = await seedAccountWithUpdatedAt(
      user_id, item_id, 'CHECKING', '0',
      new Date('2026-04-01T00:00:00Z'), 'fa-chk',
    );

    // bill_due_date = NULL; accounts.updated_at = 2026-04-12 (within +/-7d).
    await seedCreditCardWithBillDate(
      user_id,
      item_id,
      '890.00',
      new Date('2026-04-12T12:00:00Z'),
      null,
      'fa-cc',
    );

    const tx_id = await seedTransaction(
      user_id, checking_acct, '890.00', 'DEBIT',
      new Date('2026-04-15T12:00:00Z'),
    );

    await faturaDetectorWorker([
      { id: 'job-fa', name: 'pluggy.fatura-detector', data: { user_id } } as Job<{ user_id: string }>,
    ]);

    const [row] = await db
      .select({ is_credit_card_payment: transactions.is_credit_card_payment })
      .from(transactions)
      .where(eq(transactions.id, tx_id));

    expect(row.is_credit_card_payment).toBe(true);

    const [audit_row] = await db
      .select({ metadata: audit_log.metadata })
      .from(audit_log)
      .where(eq(audit_log.action, 'fatura_detected'));
    expect(audit_row).toBeDefined();
    const metadata = audit_row.metadata as Record<string, unknown>;
    expect(metadata.anchor_billdate).toBe(0);
    expect(metadata.anchor_fallback).toBe(1);
    expect(metadata.best_effort).toBe(true);
  });
});
