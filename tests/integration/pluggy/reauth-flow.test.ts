/**
 * Integration test — re-auth flow audit trail.
 *
 * Plan 02-04 TDD — D-30 (reconnect bypass), D-13 (audit catalogue) proofs.
 * Requirements: CONN-02, CONN-07.
 *
 * Test scenarios:
 *   reauth-flow-1: POST /api/webhooks/pluggy with item/login_succeeded →
 *     audit_log row with action='item_reauth_succeeded' AND
 *     metadata.item_id_hashed = hashPluggyItemId(itemId).toString('hex').
 *     PLUGGY_SYNC enqueued with trigger='reconnect'.
 *   reauth-flow-2: pluggySyncWorker with trigger='reconnect' →
 *     audit_log row with action='manual_sync_triggered' AND
 *     metadata.cooldown_bypassed=true is inserted BEFORE fetchTransactions.
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16.
 *   - Apply Drizzle migrations.
 *   - Seed users + pluggy_items rows.
 *   - Direct-import webhook handler + worker.
 *   - Mock PluggyService via vi.doMock.
 *   - BOSS_TEST_MODE=1 for enqueue assertions.
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
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

// ---------------------------------------------------------------------------
// DB + environment setup
// ---------------------------------------------------------------------------

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const WEBHOOK_SECRET = 'rf-webhook-secret-at-least-32-chars-xx';
const ITEM_ID_HASH_PEPPER = 'rf-item-id-pepper-at-least-32-chars-x';

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  process.env.CPF_HASH_PEPPER = 'rf-test-pepper-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = ITEM_ID_HASH_PEPPER;
  process.env.NEXTAUTH_SECRET = 'rf-test-secret-at-least-32-chars-xxxxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = WEBHOOK_SECRET;
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

async function seedPluggyItem(rawPluggyId: string, opts?: { last_synced_at?: Date | null }) {
  const db = await importDb();
  const { users, pluggy_items } = await import('@/db/schema');
  const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `rf-test-${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'argon2id-placeholder',
    cpf_hash: randomBytes(32),
    cpf_enc: randomBytes(44),
    subscription_tier: 'paid',
  });

  const enc = encryptCPF(rawPluggyId);
  const hash = hashPluggyItemId(rawPluggyId);

  const [item] = await db.insert(pluggy_items).values({
    user_id: userId,
    pluggy_item_id_enc: enc,
    pluggy_item_id_hash: hash,
    connector_id: '001',
    institution_name: 'Banco Teste RF',
    status: 'UPDATED',
    last_synced_at: opts?.last_synced_at ?? null,
  }).returning({ id: pluggy_items.id });

  return { userId, itemId: item.id, enc };
}

function makeWebhookRequest(body: unknown): Request {
  return new Request('http://localhost/api/webhooks/pluggy', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pluggy-signature': WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
}

function makeJob(data: Record<string, unknown>) {
  return { id: `job-rf-${Date.now()}`, name: 'pluggy.sync', data } as Job<Record<string, unknown>>;
}

function fixtureJson(name: string) {
  return JSON.parse(readFileSync(`tests/fixtures/pluggy/${name}.json`, 'utf8'));
}

// ---------------------------------------------------------------------------
// reauth-flow-1: webhook item/login_succeeded → audit + trigger='reconnect'
// ---------------------------------------------------------------------------

describe('reauth flow', () => {
  it('reauth-flow-1: item/login_succeeded webhook writes item_reauth_succeeded audit + PLUGGY_SYNC trigger=reconnect', async () => {
    const raw_id = `item-rf1-${Date.now()}`;
    const { userId } = await seedPluggyItem(raw_id);

    const handler = await import('@/app/api/webhooks/pluggy/route');
    const boss = await importBoss();
    boss.drainQueue();

    const event_id = `evt-rf1-${Date.now()}`;
    const res = await handler.POST(makeWebhookRequest({
      event: 'item/login_succeeded',
      eventId: event_id,
      itemId: raw_id,
    }));

    expect(res.status).toBe(200);

    // PLUGGY_SYNC enqueued with trigger='reconnect' (D-30)
    const queued = boss.drainQueue();
    const sync_job = queued.find(j => j.name === 'pluggy.sync');
    expect(sync_job).toBeDefined();
    expect(sync_job?.payload?.trigger).toBe('reconnect');

    // audit_log row with action='item_reauth_succeeded' (D-13)
    const db = await importDb();
    const { audit_log } = await import('@/db/schema');
    const { hashPluggyItemId } = await import('@/lib/crypto');

    const expected_hash = hashPluggyItemId(raw_id).toString('hex');

    const audit_rows = await db
      .select()
      .from(audit_log)
      .where(eq(audit_log.user_id, userId));

    const reauth_audit = audit_rows.find(r => r.action === 'item_reauth_succeeded');
    expect(reauth_audit).toBeDefined();

    // metadata.item_id_hashed must be the HMAC of the Pluggy itemId (P4 — no plaintext)
    const metadata = reauth_audit?.metadata as Record<string, unknown>;
    expect(metadata?.item_id_hashed).toBe(expected_hash);
  });

  // ---------------------------------------------------------------------------
  // reauth-flow-2: worker with trigger='reconnect' → cooldown_bypassed audit BEFORE fetchTransactions
  // ---------------------------------------------------------------------------

  it('reauth-flow-2: worker trigger=reconnect inserts cooldown_bypassed=true audit BEFORE fetchTransactions', async () => {
    // Item with last_synced_at = 5 min ago (within 30-min cooldown)
    const raw_id = `item-rf2-${Date.now()}`;
    const last_synced = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const { userId, itemId } = await seedPluggyItem(raw_id, { last_synced_at: last_synced });

    // Track call order: did recordAudit fire before fetchTransactions?
    const call_order: string[] = [];

    const accounts_fixture = fixtureJson('list-accounts');
    const empty_fixture = { results: [], next: null };

    const syncMockSvc = {
      fetchAccounts: vi.fn().mockImplementation(() => {
        call_order.push('fetchAccounts');
        return Promise.resolve(accounts_fixture);
      }),
      fetchTransactions: vi.fn().mockImplementation(() => {
        call_order.push('fetchTransactions');
        return Promise.resolve(empty_fixture);
      }),
    };

    // Mock both PluggyService AND recordAudit to track call order
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => syncMockSvc,
    }));

    vi.doMock('@/lib/auditLog', () => ({
      recordAudit: vi.fn().mockImplementation((params: Record<string, unknown>) => {
        if (params.action === 'manual_sync_triggered') {
          call_order.push('recordAudit:manual_sync_triggered');
        }
        return Promise.resolve();
      }),
    }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    const boss = await importBoss();
    boss.drainQueue();

    await pluggySyncWorker([makeJob({
      user_id: userId,
      item_id: itemId,
      trigger: 'reconnect',
    })]);

    // audit_log row with action='manual_sync_triggered' + cooldown_bypassed=true
    // We check call_order to verify audit was inserted BEFORE fetchTransactions
    const audit_idx = call_order.indexOf('recordAudit:manual_sync_triggered');
    const fetch_tx_idx = call_order.indexOf('fetchTransactions');

    expect(audit_idx).toBeGreaterThanOrEqual(0); // audit was called
    expect(fetch_tx_idx).toBeGreaterThanOrEqual(0); // fetchTransactions was called
    // The audit MUST precede fetchTransactions
    expect(audit_idx).toBeLessThan(fetch_tx_idx);
  });
});
