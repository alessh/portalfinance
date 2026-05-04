/**
 * Integration test — pluggySyncWorker accepts the redacted payload shape.
 *
 * Closes 02-REVIEWS.md Concern #1 (HIGH) on the worker side: after the
 * webhook receiver redacts pluggy_item_id out of the job payload, workers
 * must look up the internal pluggy_items row by hex-decoding
 * job.data.item_id_hash_hex and comparing against pluggy_item_id_hash.
 *
 * Scenarios:
 *   jobpayload-1: invoke pluggySyncWorker with { item_id_hash_hex, trigger: 'webhook' }
 *     (NO item_id, NO item_id_pluggy) → worker resolves the seeded item, runs
 *     the mocked PluggyService, flips status=UPDATED. No sync_skipped warning.
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
import { sql, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const ITEM_ID_HASH_PEPPER = 'jobpayload-pepper-at-least-32-chars-xx';

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  process.env.CPF_HASH_PEPPER = 'jobpayload-cpf-pepper-at-least-32-chars';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = ITEM_ID_HASH_PEPPER;
  process.env.NEXTAUTH_SECRET = 'jobpayload-secret-at-least-32-chars-xxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'jobpayload-webhook-secret-at-least-32-x';
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

function makeJob(data: Record<string, unknown>): Job<Record<string, unknown>> {
  return { id: `job-${Date.now()}-${Math.random()}`, name: 'pluggy.sync', data } as Job<Record<string, unknown>>;
}

describe('pluggySyncWorker accepts redacted payload (Concern #1)', () => {
  it('jobpayload-1: { item_id_hash_hex, trigger:"webhook" } resolves the item by pluggy_item_id_hash and proceeds', async () => {
    const { db } = await import('@/db');
    const { users, pluggy_items } = await import('@/db/schema');
    const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

    const user_id = crypto.randomUUID();
    await db.insert(users).values({
      id: user_id,
      email: `jobp-${Date.now()}-${Math.random()}@example.com`,
      password_hash: 'argon2id-placeholder',
      cpf_hash: randomBytes(32),
      cpf_enc: randomBytes(44),
      subscription_tier: 'paid',
    });

    const plaintext_item_id = `item-jobp-${Date.now()}`;
    const item_enc = encryptCPF(plaintext_item_id);
    const item_hash_buf = hashPluggyItemId(plaintext_item_id);
    const item_hash_hex = item_hash_buf.toString('hex');

    const [item] = await db.insert(pluggy_items).values({
      user_id,
      pluggy_item_id_enc: item_enc,
      pluggy_item_id_hash: item_hash_buf,
      connector_id: '001',
      institution_name: 'Banco Jobpayload Teste',
      status: 'UPDATED',
    }).returning({ id: pluggy_items.id });

    // Mock PluggyService with a single empty account list — we only need to
    // prove the lookup path resolves the item_row from item_id_hash_hex.
    const mockSvc = {
      fetchAccounts: vi.fn().mockResolvedValue({ results: [] }),
      fetchTransactions: vi.fn().mockResolvedValue({ results: [], next: null }),
    };
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => mockSvc,
    }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    const boss = await import('@/jobs/boss');
    boss.drainQueue();

    await pluggySyncWorker([
      makeJob({ item_id_hash_hex: item_hash_hex, trigger: 'webhook' }),
    ]);

    // (a) item lookup succeeded → fetchAccounts was invoked exactly once
    expect(mockSvc.fetchAccounts).toHaveBeenCalledTimes(1);

    // (b) item.status flipped to UPDATED (worker reached the success branch)
    const [row] = await db
      .select({ status: pluggy_items.status, last_synced_at: pluggy_items.last_synced_at })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, item.id));
    expect(row.status).toBe('UPDATED');
    expect(row.last_synced_at).toBeTruthy();

    // (c) transfer + fatura detectors enqueued (proof the success branch ran)
    const queued = boss.drainQueue();
    expect(queued.some(j => j.name === 'pluggy.transfer-detector')).toBe(true);
    expect(queued.some(j => j.name === 'pluggy.fatura-detector')).toBe(true);
  });
});
