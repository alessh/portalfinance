/**
 * Integration test — POST /api/pluggy/items (pluggy-items-1..3) + GET /api/sync-status (sync-status-1..2).
 *
 * Plan 02-03 — Proves:
 *   - POST /api/pluggy/items: 202, pluggy_items row encrypted, consent row, PLUGGY_SYNC enqueued, audit. (pluggy-items-1)
 *   - POST /api/pluggy/items same pluggy_item_id → 409 Conflict, no second row. (pluggy-items-2)
 *   - POST /api/pluggy/items no session → 401. (pluggy-items-3)
 *   - GET /api/sync-status while pluggy_items.status=UPDATING → { phase: 'loading_accounts', transactions_count: 0 }. (sync-status-1)
 *   - GET /api/sync-status after 1 transaction inserted → { phase: 'completed', transactions_count: >= 1 }. (sync-status-2)
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16.
 *   - Apply Drizzle migrations.
 *   - BOSS_TEST_MODE=1 so enqueue() writes to in-memory test queue.
 *   - Import route handlers directly (no HTTP server).
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
import { startTestDb, type TestDb } from '../../fixtures/db';

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let td: TestDb;
let pg: ReturnType<typeof postgres>;

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 6).toString('base64');
  process.env.CPF_HASH_PEPPER = 'ci-items-pepper-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'ci-items-pluggy-pepper-32-chars-xxxxxxx';
  process.env.NEXTAUTH_SECRET = 'ci-items-secret-at-least-32-chars-xxxxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'test-webhook-secret-at-least-32-chars-x';
  process.env.BOSS_TEST_MODE = '1';
  // NODE_ENV is already 'test' when vitest runs; do not reassign (TypeScript read-only).

  pg = postgres(td.url, { max: 1 });
  const db = drizzle(pg);

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await migrate(db, { migrationsFolder: './src/db/migrations' });
}, 180_000);

afterAll(async () => {
  await pg.end();
  await td.stop();
});

beforeEach(() => {
  vi.resetModules();
  // Drain the in-memory test queue before each test.
  // Import boss dynamically after resetModules.
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importItemsRouteHandler() {
  const mod = await import('@/app/api/pluggy/items/route');
  return mod.POST;
}

async function importSyncStatusRouteHandler() {
  const mod = await import('@/app/api/sync-status/route');
  return mod.GET;
}

async function importDb() {
  const { db } = await import('@/db');
  return db;
}

async function importBoss() {
  const { drainQueue } = await import('@/jobs/boss');
  return { drainQueue };
}

async function createUserAndSession(): Promise<{ userId: string; sessionToken: string }> {
  const db = await importDb();
  const { users, sessions } = await import('@/db/schema');

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `items-${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'argon2id-placeholder',
    cpf_hash: randomBytes(32),
    // cpf_enc length=39 simulates a user who already set a real CPF (skips CPF requirement).
    cpf_enc: randomBytes(39),
    subscription_tier: 'paid',
  });

  const sessionToken = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    user_id: userId,
    session_token: sessionToken,
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return { userId, sessionToken };
}

function makeItemsRequest(body: unknown, sessionToken?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sessionToken) {
    headers['cookie'] = `authjs.session-token=${sessionToken}`;
  }
  return new Request('http://localhost/api/pluggy/items', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeSyncStatusRequest(sessionToken?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['cookie'] = `authjs.session-token=${sessionToken}`;
  }
  return new Request('http://localhost/api/sync-status', { headers });
}

// ---------------------------------------------------------------------------
// POST /api/pluggy/items tests
// ---------------------------------------------------------------------------

describe('POST /api/pluggy/items', () => {
  it('pluggy-items-1: 202, encrypted item row, consent row, PLUGGY_SYNC enqueued, audit', async () => {
    const handler = await importItemsRouteHandler();
    const db = await importDb();
    const { pluggy_items, user_consents, audit_log } = await import('@/db/schema');
    const { drainQueue } = await importBoss();

    // Drain any previous test queue entries.
    drainQueue();

    const { userId, sessionToken } = await createUserAndSession();
    const PLUGGY_ITEM_ID = `item-${Date.now()}`;
    const CONNECTOR_ID = 'itau-banking';

    const res = await handler(makeItemsRequest({
      pluggy_item_id: PLUGGY_ITEM_ID,
      connector_id: CONNECTOR_ID,
      institution_name: 'Itaú Unibanco',
    }, sessionToken));

    expect(res.status).toBe(202);
    const body = await res.json() as { id: string };
    expect(body.id).toBeTruthy();
    const inserted_id = body.id;

    // Assert: pluggy_items row with encrypted data.
    const [item] = await db
      .select({ pluggy_item_id_enc: pluggy_items.pluggy_item_id_enc, pluggy_item_id_hash: pluggy_items.pluggy_item_id_hash, user_id: pluggy_items.user_id })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, inserted_id));
    expect(item).toBeDefined();
    expect(item.user_id).toBe(userId);
    // Encrypted item: Buffer with length > 12 (IV) + 16 (tag) = > 28 bytes.
    expect((item.pluggy_item_id_enc as Buffer).byteLength).toBeGreaterThan(12);
    expect((item.pluggy_item_id_hash as Buffer).byteLength).toBeGreaterThan(0);

    // Assert: per-connector consent row.
    const consents = await db
      .select({ scope: user_consents.scope })
      .from(user_consents)
      .where(eq(user_consents.user_id, userId));
    const connectorConsent = consents.find(c => c.scope === `PLUGGY_CONNECTOR:${CONNECTOR_ID}`);
    expect(connectorConsent).toBeDefined();

    // Assert: PLUGGY_SYNC enqueued exactly once with singletonKey=user_id.
    const queued = drainQueue();
    const syncJobs = queued.filter(j => j.name === 'pluggy.sync');
    expect(syncJobs).toHaveLength(1);
    expect((syncJobs[0].payload as { user_id: string }).user_id).toBe(userId);
    expect((syncJobs[0].payload as { item_id: string }).item_id).toBe(inserted_id);

    // Assert: audit_log row with action='item_connected'.
    const audits = await db
      .select({ action: audit_log.action })
      .from(audit_log)
      .where(eq(audit_log.user_id, userId));
    const connected = audits.find(a => a.action === 'item_connected');
    expect(connected).toBeDefined();
  });

  it('pluggy-items-2: same pluggy_item_id → 409 Conflict, no second row', async () => {
    const handler = await importItemsRouteHandler();
    const db = await importDb();
    const { pluggy_items } = await import('@/db/schema');
    const { drainQueue } = await importBoss();
    drainQueue();

    const { sessionToken } = await createUserAndSession();
    const PLUGGY_ITEM_ID = `item-dup-${Date.now()}`;

    // First call — should succeed.
    const res1 = await handler(makeItemsRequest({
      pluggy_item_id: PLUGGY_ITEM_ID,
      connector_id: 'bradesco',
      institution_name: 'Bradesco',
    }, sessionToken));
    expect(res1.status).toBe(202);

    // Count rows before second call.
    const countBefore = await db.select().from(pluggy_items);

    // Second call with same pluggy_item_id → 409.
    const res2 = await handler(makeItemsRequest({
      pluggy_item_id: PLUGGY_ITEM_ID,
      connector_id: 'bradesco',
      institution_name: 'Bradesco',
    }, sessionToken));
    expect(res2.status).toBe(409);
    const body2 = await res2.json() as { error: string };
    expect(body2.error).toBe('ALREADY_CONNECTED');

    // Count rows after — should be identical.
    const countAfter = await db.select().from(pluggy_items);
    expect(countAfter.length).toBe(countBefore.length);
  });

  it('pluggy-items-3: no session → 401', async () => {
    const handler = await importItemsRouteHandler();
    const res = await handler(makeItemsRequest({
      pluggy_item_id: 'item-nosession',
      connector_id: 'itau-banking',
      institution_name: 'Itaú',
    }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sync-status tests
// ---------------------------------------------------------------------------

describe('GET /api/sync-status', () => {
  it('sync-status-1: item.status=UPDATING and no accounts → phase=loading_accounts, transactions_count=0', async () => {
    const handler = await importSyncStatusRouteHandler();
    const db = await importDb();
    const { pluggy_items } = await import('@/db/schema');
    const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

    const { userId, sessionToken } = await createUserAndSession();

    // Insert a pluggy_items row with status=UPDATING (no accounts).
    await db.insert(pluggy_items).values({
      user_id: userId,
      pluggy_item_id_enc: encryptCPF('test-item-status-1'),
      pluggy_item_id_hash: hashPluggyItemId('test-item-status-1'),
      connector_id: 'test-connector',
      institution_name: 'Test Bank',
      status: 'UPDATING',
    });

    const res = await handler(makeSyncStatusRequest(sessionToken));
    expect(res.status).toBe(200);
    const body = await res.json() as { phase: string; transactions_count: number };
    expect(body.phase).toBe('loading_accounts');
    expect(body.transactions_count).toBe(0);
  });

  it('sync-status-2: after 1 transaction inserted → phase=completed, transactions_count >= 1', async () => {
    const handler = await importSyncStatusRouteHandler();
    const db = await importDb();
    const { pluggy_items, accounts, transactions } = await import('@/db/schema');
    const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

    const { userId, sessionToken } = await createUserAndSession();

    // Insert pluggy_items row.
    const [item] = await db.insert(pluggy_items).values({
      user_id: userId,
      pluggy_item_id_enc: encryptCPF('test-item-status-2'),
      pluggy_item_id_hash: hashPluggyItemId('test-item-status-2'),
      connector_id: 'test-connector',
      institution_name: 'Test Bank',
      status: 'UPDATING',
    }).returning({ id: pluggy_items.id });

    // Insert an account for this item.
    const [account] = await db.insert(accounts).values({
      user_id: userId,
      pluggy_item_id: item.id,
      pluggy_account_id: `acc-${Date.now()}`,
      type: 'CHECKING',
      name: 'Conta Corrente',
      currency: 'BRL',
      balance: '1000.00',
      status: 'ACTIVE',
    }).returning({ id: accounts.id });

    // Insert a transaction for this user.
    await db.insert(transactions).values({
      user_id: userId,
      account_id: account.id,
      pluggy_transaction_id: `tx-${Date.now()}`,
      type: 'DEBIT',
      amount: '50.00',
      currency: 'BRL',
      description: 'Test transaction',
      posted_at: new Date(),
      status: 'POSTED',
      raw_payload: {},
    });

    const res = await handler(makeSyncStatusRequest(sessionToken));
    expect(res.status).toBe(200);
    const body = await res.json() as { phase: string; transactions_count: number };
    expect(body.phase).toBe('completed');
    expect(body.transactions_count).toBeGreaterThanOrEqual(1);
  });
});
