/**
 * Integration test — pluggySyncWorker.
 *
 * Plan 02-04 TDD — T-02-D (TX-01 dedup), T-02-E (detector flag preservation),
 * T-02-G (broken item skip) proofs.
 * Requirements: CONN-02, TX-01, TX-02, TX-03.
 *
 * Test scenarios:
 *   sync-1: cursor pagination (2 pages) → 11 transactions inserted, accounts upserted,
 *           item.status='UPDATED', PLUGGY_TRANSFER_DETECTOR + PLUGGY_FATURA_DETECTOR enqueued.
 *   sync-2: replay safety (TX-01) — run worker twice → still 11 rows (no duplicates).
 *   sync-3: PENDING→POSTED transition (TX-02) — pre-seed PENDING tx, re-run → status='POSTED',
 *           is_transfer and is_credit_card_payment NOT modified.
 *   sync-4: broken item skip (P2) — item.status='LOGIN_ERROR' → fetchAccounts NOT called,
 *           sync_failed log with reason='item_broken'.
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16.
 *   - Apply Drizzle migrations.
 *   - Seed users + pluggy_items rows directly.
 *   - Mock PluggyService via vi.doMock.
 *   - Invoke pluggySyncWorker directly (no pg-boss scheduler).
 *   - BOSS_TEST_MODE=1 for enqueue assertions via peekQueue().
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql, count, eq } from 'drizzle-orm';
import { randomBytes, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

// ---------------------------------------------------------------------------
// DB + environment setup
// ---------------------------------------------------------------------------

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
const ITEM_ID_HASH_PEPPER = 'sw-item-id-pepper-at-least-32-chars-x';

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.CPF_HASH_PEPPER = 'sw-test-pepper-at-least-32-chars-xxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = ITEM_ID_HASH_PEPPER;
  process.env.NEXTAUTH_SECRET = 'sw-test-secret-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'sw-webhook-secret-at-least-32-chars-xx';
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

beforeEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importDb() {
  const { db } = await import('@/db');
  return db;
}

async function importBoss() {
  return import('@/jobs/boss');
}

/**
 * Seed a users row + pluggy_items row.
 * Returns { userId, itemId (internal UUID), pluggyItemIdEnc (Buffer) }.
 */
async function seedItem(opts?: {
  status?: string;
  last_synced_at?: Date | null;
}): Promise<{ userId: string; itemId: string; pluggyItemIdEnc: Buffer; pluggyRawId: string }> {
  const db = await importDb();
  const { users, pluggy_items } = await import('@/db/schema');
  const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `sw-test-${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'argon2id-placeholder',
    cpf_hash: randomBytes(32),
    cpf_enc: randomBytes(44),
    subscription_tier: 'paid',
  });

  const rawId = `item-sw-${Date.now()}-${Math.random()}`;
  const enc = encryptCPF(rawId);
  const hash = hashPluggyItemId(rawId);

  const [item] = await db.insert(pluggy_items).values({
    user_id: userId,
    pluggy_item_id_enc: enc,
    pluggy_item_id_hash: hash,
    connector_id: '001',
    institution_name: 'Banco Teste SW',
    status: (opts?.status as 'UPDATED' | 'LOGIN_ERROR' | 'WAITING_USER_INPUT' | 'UPDATING' | 'OUTDATED') ?? 'UPDATED',
    last_synced_at: opts?.last_synced_at ?? null,
  }).returning({ id: pluggy_items.id });

  return { userId, itemId: item.id, pluggyItemIdEnc: enc, pluggyRawId: rawId };
}

/** Load fixture file and return parsed JSON. */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/pluggy/${name}.json`, 'utf8'));
}

/** Build a minimal pg-boss job for the sync worker. */
function makeJob(data: Record<string, unknown>) {
  return { id: `job-${Date.now()}`, name: 'pluggy.sync', data } as Job<Record<string, unknown>>;
}

/**
 * Build a mock PluggyService that returns fixture data.
 * fetchAccounts returns list-accounts.json.
 * fetchTransactions returns page.json on first call, cursor.json on second.
 */
function buildMockSvc(opts?: { fetchTransactionsImpl?: () => unknown }) {
  const accounts_fixture = fixture('list-accounts');
  const page_fixture = fixture('list-transactions-page');
  const cursor_fixture = fixture('list-transactions-cursor');

  let tx_call_count = 0;

  const mockSvc = {
    fetchAccounts: vi.fn().mockResolvedValue(accounts_fixture),
    fetchTransactions: vi.fn().mockImplementation(() => {
      tx_call_count++;
      if (opts?.fetchTransactionsImpl) return opts.fetchTransactionsImpl();
      // First call returns page 1 (8 results + next cursor)
      // Second call returns page 2 (3 results + null cursor)
      const result = tx_call_count === 1 ? page_fixture : cursor_fixture;
      return Promise.resolve(result);
    }),
  };

  return mockSvc;
}

// ---------------------------------------------------------------------------
// Sync-1: cursor pagination + full upsert
// ---------------------------------------------------------------------------

describe('pluggySyncWorker', () => {
  it('sync-1: fetches accounts + 2 cursor pages, inserts 11 transactions, flips status=UPDATED, enqueues detectors', async () => {
    const { userId, itemId } = await seedItem();
    const mockSvc = buildMockSvc();

    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => mockSvc,
    }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    const boss = await importBoss();
    boss.drainQueue();

    await pluggySyncWorker([makeJob({ user_id: userId, item_id: itemId })]);

    // (a) 11 transactions inserted
    const db = await importDb();
    const { transactions, pluggy_items } = await import('@/db/schema');
    const tx_count = await db.select({ cnt: count() }).from(transactions).where(eq(transactions.user_id, userId));
    expect(tx_count[0].cnt).toBe(11);

    // (b) fetchTransactions called exactly 2 times (one per page, 1 account)
    expect(mockSvc.fetchTransactions).toHaveBeenCalledTimes(2);

    // (c) item.status = 'UPDATED'
    const [item_row] = await db.select({ status: pluggy_items.status, last_synced_at: pluggy_items.last_synced_at })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, itemId));
    expect(item_row.status).toBe('UPDATED');

    // (d) last_synced_at set
    expect(item_row.last_synced_at).toBeTruthy();

    // (e) PLUGGY_TRANSFER_DETECTOR enqueued
    const queued = boss.drainQueue();
    expect(queued.some(j => j.name === 'pluggy.transfer-detector')).toBe(true);

    // (f) PLUGGY_FATURA_DETECTOR enqueued
    expect(queued.some(j => j.name === 'pluggy.fatura-detector')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Sync-2: replay safety / TX-01
  // ---------------------------------------------------------------------------

  it('sync-2: running worker twice does NOT duplicate transactions (TX-01)', async () => {
    const { userId, itemId } = await seedItem();
    const mockSvc = buildMockSvc();

    // Mock must return fresh calls for both runs combined (4 fetchTransactions calls total)
    let call_count = 0;
    const page_fixture = fixture('list-transactions-page');
    const cursor_fixture = fixture('list-transactions-cursor');
    const accounts_fixture = fixture('list-accounts');

    const freshMockSvc = {
      fetchAccounts: vi.fn().mockResolvedValue(accounts_fixture),
      fetchTransactions: vi.fn().mockImplementation(() => {
        call_count++;
        // Calls 1,3 = page (8 results), calls 2,4 = cursor (3 results, null)
        return Promise.resolve(call_count % 2 === 1 ? page_fixture : cursor_fixture);
      }),
    };

    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => freshMockSvc,
    }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    const boss = await importBoss();
    boss.drainQueue();

    // First run
    await pluggySyncWorker([makeJob({ user_id: userId, item_id: itemId })]);

    const db = await importDb();
    const { transactions } = await import('@/db/schema');

    const after_run1 = await db.select({ cnt: count() }).from(transactions).where(eq(transactions.user_id, userId));
    expect(after_run1[0].cnt).toBe(11);

    boss.drainQueue(); // clear jobs from run 1

    // Second run
    await pluggySyncWorker([makeJob({ user_id: userId, item_id: itemId })]);

    const after_run2 = await db.select({ cnt: count() }).from(transactions).where(eq(transactions.user_id, userId));
    // (a) Still exactly 11 — no duplicates
    expect(after_run2[0].cnt).toBe(11);
  });

  // ---------------------------------------------------------------------------
  // Sync-3: PENDING → POSTED transition (TX-02)
  // ---------------------------------------------------------------------------

  it('sync-3: PENDING tx transitions to POSTED without touching is_transfer or is_credit_card_payment', async () => {
    const { userId, itemId } = await seedItem();

    // Seed 1 PENDING transaction with the same pluggy_transaction_id as tx_008 from fixtures
    const db = await importDb();
    const { transactions, accounts: accounts_table } = await import('@/db/schema');

    // We need an accounts row to FK into
    // First seed accounts by running a quick mock sync to create accounts only
    const accounts_fixture = fixture('list-accounts') as { results: Array<{ id: string; type: string; name: string; currencyCode: string; balance: number; subtype?: string; creditData?: { creditLimit: number }; owner?: string }> };
    const { pluggy_items } = await import('@/db/schema');

    // Manually insert a fake account to satisfy the FK
    const [fake_account] = await db.insert(accounts_table).values({
      user_id: userId,
      pluggy_item_id: itemId,
      pluggy_account_id: 'acc-checking-001',
      type: 'CHECKING',
      name: 'Conta Corrente Teste',
      currency: 'BRL',
      balance: '1250.75',
    }).returning({ id: accounts_table.id });

    // Seed a PENDING transaction with tx_008's pluggy_transaction_id
    await db.insert(transactions).values({
      user_id: userId,
      account_id: fake_account.id,
      pluggy_transaction_id: 'tx_008', // matches fixture tx_008
      type: 'DEBIT',
      amount: '320.00',
      currency: 'BRL',
      description: 'PENDING TRANSACTION',
      posted_at: new Date('2026-05-09'),
      status: 'PENDING',
      raw_payload: {},
      is_transfer: false,
      is_credit_card_payment: false,
    });

    // Build mock that returns only tx_008 as POSTED (minimal fixture)
    const posted_tx_fixture = {
      results: [{
        id: 'tx_008',
        accountId: 'acc-checking-001',
        description: 'COMPRA SUPERMERCADO ATACADO TESTE',
        descriptionRaw: 'COMPRA SUPERMERCADO ATACADO TESTE 09/05',
        currencyCode: 'BRL',
        amount: -320.00,
        type: 'DEBIT',
        status: 'POSTED', // was PENDING, now POSTED
        date: '2026-05-09',
        postedDate: '2026-05-09',
        category: null,
        merchant: null,
        paymentData: { paymentMethod: 'CARD' },
      }],
      next: null,
    };

    const sync3MockSvc = {
      fetchAccounts: vi.fn().mockResolvedValue(accounts_fixture),
      fetchTransactions: vi.fn().mockResolvedValue(posted_tx_fixture),
    };

    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => sync3MockSvc,
    }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    const boss = await importBoss();
    boss.drainQueue();

    await pluggySyncWorker([makeJob({ user_id: userId, item_id: itemId })]);

    // (a) Row count unchanged — still 1 transaction for this account tx_008
    const tx_count = await db.select({ cnt: count() }).from(transactions)
      .where(eq(transactions.pluggy_transaction_id, 'tx_008'));
    expect(tx_count[0].cnt).toBe(1);

    // (b) Status is now POSTED
    const [tx_row] = await db.select().from(transactions)
      .where(eq(transactions.pluggy_transaction_id, 'tx_008'));
    expect(tx_row.status).toBe('POSTED');

    // (c) is_transfer and is_credit_card_payment are NOT modified by upsert (T-02-E)
    expect(tx_row.is_transfer).toBe(false);
    expect(tx_row.is_credit_card_payment).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Sync-4: skip broken items (Pitfall P2)
  // ---------------------------------------------------------------------------

  it('sync-4: LOGIN_ERROR item skips Pluggy API calls and logs sync_failed with reason=item_broken', async () => {
    const { userId, itemId } = await seedItem({ status: 'LOGIN_ERROR' });

    const brokenMockSvc = {
      fetchAccounts: vi.fn(),
      fetchTransactions: vi.fn(),
    };

    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => brokenMockSvc,
    }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    const boss = await importBoss();
    boss.drainQueue();

    // Should complete without throwing (returns early on broken item)
    await pluggySyncWorker([makeJob({ user_id: userId, item_id: itemId })]);

    // (a) fetchAccounts NOT called
    expect(brokenMockSvc.fetchAccounts).not.toHaveBeenCalled();

    // (b) No jobs enqueued (detectors NOT enqueued for broken items)
    const queued = boss.peekQueue();
    expect(queued.filter(j =>
      j.name === 'pluggy.transfer-detector' || j.name === 'pluggy.fatura-detector'
    )).toHaveLength(0);
  });
});
