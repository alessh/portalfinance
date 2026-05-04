/**
 * Integration test — POST /api/pluggy/items/:id/sync (cooldown enforcement).
 *
 * Plan 02-06 Task 2 — Covers:
 *   - cooldown-1: paid user, within 30-min cooldown → 429 with retry_after_seconds
 *   - cooldown-2: paid user, past cooldown → 202 Accepted + PLUGGY_SYNC enqueued + audit
 *   - cooldown-3: free-tier user → 403 PAYWALL
 *   - cooldown-4: IDOR — user A session, user B's item id → 404 (NOT 403, P26)
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16, apply Drizzle migrations.
 *   - BOSS_TEST_MODE=1 so enqueue() writes to in-memory test queue.
 *   - Import route handler directly (no HTTP server).
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
import { sql } from 'drizzle-orm';
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
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.CPF_HASH_PEPPER = 'ci-cooldown-pepper-at-least-32-chars-xxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'ci-cooldown-pluggy-pepper-32-chars-xxxxx';
  process.env.NEXTAUTH_SECRET = 'ci-cooldown-secret-at-least-32-chars-xxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'test-webhook-secret-at-least-32-chars-x';
  process.env.BOSS_TEST_MODE = '1';

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
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function importSyncRouteHandler() {
  const mod = await import('@/app/api/pluggy/items/[id]/sync/route');
  return mod.POST;
}

async function importDb() {
  const { db } = await import('@/db');
  return db;
}

async function importBoss() {
  const { drainQueue } = await import('@/jobs/boss');
  return { drainQueue };
}

async function createUserAndSession(tier: 'free' | 'paid' = 'paid'): Promise<{
  userId: string;
  sessionToken: string;
}> {
  const db = await importDb();
  const { users, sessions } = await import('@/db/schema');

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `cooldown-${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'argon2id-placeholder',
    cpf_hash: randomBytes(32),
    cpf_enc: randomBytes(39),
    subscription_tier: tier,
  });

  const sessionToken = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    user_id: userId,
    session_token: sessionToken,
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return { userId, sessionToken };
}

async function createPluggyItem(
  userId: string,
  opts: { last_synced_at?: Date | null; last_manual_sync_at?: Date | null } = {},
): Promise<string> {
  const db = await importDb();
  const { pluggy_items } = await import('@/db/schema');
  const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

  const pluggy_item_id = `test-item-${Date.now()}-${Math.random()}`;
  const enc = encryptCPF(pluggy_item_id);
  const hash = hashPluggyItemId(pluggy_item_id);

  const rows = await db
    .insert(pluggy_items)
    .values({
      user_id: userId,
      pluggy_item_id_enc: enc,
      pluggy_item_id_hash: hash,
      connector_id: 'itau-banking',
      institution_name: 'Itaú',
      status: 'UPDATED',
      last_synced_at: opts.last_synced_at ?? null,
      last_manual_sync_at: opts.last_manual_sync_at ?? null,
    })
    .returning({ id: pluggy_items.id });

  return rows[0].id;
}

function makeSyncRequest(itemId: string, sessionToken?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['cookie'] = `authjs.session-token=${sessionToken}`;
  }
  return new Request(`http://localhost/api/pluggy/items/${itemId}/sync`, {
    method: 'POST',
    headers,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/pluggy/items/:id/sync', () => {
  it('cooldown-1: paid user within 30-min cooldown (last_manual_sync_at 5 min ago) → 429 COOLDOWN_ACTIVE', async () => {
    const handler = await importSyncRouteHandler();
    const { userId, sessionToken } = await createUserAndSession('paid');

    // Concern #12 (plan 02-18): cooldown anchor migrated from
    // last_synced_at to last_manual_sync_at.
    const five_min_ago = new Date(Date.now() - 5 * 60 * 1000);
    const itemId = await createPluggyItem(userId, { last_manual_sync_at: five_min_ago });

    const req = makeSyncRequest(itemId, sessionToken);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; retry_after_seconds: number };
    expect(body.error).toBe('COOLDOWN_ACTIVE');
    // ~25 minutes remaining (1500 seconds ± some buffer)
    expect(body.retry_after_seconds).toBeGreaterThan(1400);
    expect(body.retry_after_seconds).toBeLessThanOrEqual(1500);
    // Retry-After header should be set
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('cooldown-2: paid user past cooldown → 202 + PLUGGY_SYNC enqueued + audit', async () => {
    const handler = await importSyncRouteHandler();
    const db = await importDb();
    const { audit_log } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { drainQueue } = await importBoss();

    drainQueue(); // clear any leftover jobs

    const { userId, sessionToken } = await createUserAndSession('paid');

    // Past cooldown — last_manual_sync_at 35 min ago (Concern #12 anchor).
    const thirty_five_min_ago = new Date(Date.now() - 35 * 60 * 1000);
    const itemId = await createPluggyItem(userId, { last_manual_sync_at: thirty_five_min_ago });

    const req = makeSyncRequest(itemId, sessionToken);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    expect(res.status).toBe(202);
    const body = await res.json() as { accepted: boolean };
    expect(body.accepted).toBe(true);

    // Assert: PLUGGY_SYNC enqueued with trigger='manual', singletonKey=userId
    const queued = drainQueue();
    const syncJobs = queued.filter((j) => j.name === 'pluggy.sync');
    expect(syncJobs).toHaveLength(1);
    expect((syncJobs[0].payload as { trigger: string }).trigger).toBe('manual');
    expect((syncJobs[0].payload as { user_id: string }).user_id).toBe(userId);

    // Assert: audit_log row with action='manual_sync_triggered', cooldown_bypassed=false
    const audits = await db
      .select({ action: audit_log.action, metadata: audit_log.metadata })
      .from(audit_log)
      .where(eq(audit_log.user_id, userId));
    const syncAudit = audits.find((a) => a.action === 'manual_sync_triggered');
    expect(syncAudit).toBeDefined();
    expect((syncAudit!.metadata as { cooldown_bypassed: boolean }).cooldown_bypassed).toBe(false);
  });

  it('cooldown-3: free-tier user → 403 PAYWALL (PLUGGY_SYNC NOT enqueued)', async () => {
    const handler = await importSyncRouteHandler();
    const { drainQueue } = await importBoss();

    drainQueue(); // clear any leftover jobs

    const { userId, sessionToken } = await createUserAndSession('free');

    // last_synced_at = 1 hour ago (past cooldown — but still blocked by free tier)
    const one_hour_ago = new Date(Date.now() - 60 * 60 * 1000);
    const itemId = await createPluggyItem(userId, { last_synced_at: one_hour_ago });

    const req = makeSyncRequest(itemId, sessionToken);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; upgrade_url: string };
    expect(body.error).toBe('PAYWALL');
    expect(body.upgrade_url).toBe('/settings/billing');

    // Assert: PLUGGY_SYNC NOT enqueued
    const queued = drainQueue();
    const syncJobs = queued.filter((j) => j.name === 'pluggy.sync');
    expect(syncJobs).toHaveLength(0);
  });

  it('cooldown-4: IDOR — user A session, user B item → 404 (not 403, P26)', async () => {
    const handler = await importSyncRouteHandler();

    const { userId: userA_id, sessionToken: userA_token } = await createUserAndSession('paid');
    const { userId: userB_id } = await createUserAndSession('paid');

    // Create item owned by user B
    const itemId = await createPluggyItem(userB_id, {});

    // User A tries to sync user B's item
    const req = makeSyncRequest(itemId, userA_token);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    // Must be 404 — NOT 403 (P26: IDOR guard returns 404 to not leak existence)
    expect(res.status).toBe(404);

    // Silence unused variable warning
    void userA_id;
  });

  // ---------------------------------------------------------------------------
  // Plan 02-18 — Concern #12: cooldown anchor migrated to last_manual_sync_at.
  // ---------------------------------------------------------------------------

  it('cooldown-B: failed manual sync (last_manual_sync_at NULL) does NOT cool down', async () => {
    const handler = await importSyncRouteHandler();
    const { userId, sessionToken } = await createUserAndSession('paid');

    // Failed prior manual sync — last_manual_sync_at stays NULL because the
    // worker only writes it inside the success path. Recent unrelated webhook
    // sync also exists (last_synced_at recent) but must NOT block the retry.
    const five_min_ago = new Date(Date.now() - 5 * 60 * 1000);
    const itemId = await createPluggyItem(userId, {
      last_synced_at: five_min_ago,
      last_manual_sync_at: null,
    });

    const req = makeSyncRequest(itemId, sessionToken);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    expect(res.status).toBe(202);
    const body = await res.json() as { accepted: boolean };
    expect(body.accepted).toBe(true);
  });

  it('cooldown-C: recent webhook sync does NOT block subsequent manual sync', async () => {
    const handler = await importSyncRouteHandler();
    const { drainQueue } = await importBoss();
    drainQueue();

    const { userId, sessionToken } = await createUserAndSession('paid');

    // Webhook synced 5 min ago (last_synced_at is recent), no prior manual
    // sync (last_manual_sync_at NULL). Manual sync MUST proceed.
    const five_min_ago = new Date(Date.now() - 5 * 60 * 1000);
    const itemId = await createPluggyItem(userId, {
      last_synced_at: five_min_ago,
      last_manual_sync_at: null,
    });

    const req = makeSyncRequest(itemId, sessionToken);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    expect(res.status).toBe(202);
    const queued = drainQueue();
    expect(queued.filter((j) => j.name === 'pluggy.sync')).toHaveLength(1);
  });

  it('worker-A: trigger="manual" success path writes last_manual_sync_at', async () => {
    const db = await importDb();
    const { users, pluggy_items } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `worker-A-${Date.now()}-${Math.random()}@example.com`,
      password_hash: 'argon2id-placeholder',
      cpf_hash: randomBytes(32),
      cpf_enc: randomBytes(39),
      subscription_tier: 'paid',
    });

    const plaintext = `item-worker-A-${Date.now()}`;
    const [item] = await db.insert(pluggy_items).values({
      user_id: userId,
      pluggy_item_id_enc: encryptCPF(plaintext),
      pluggy_item_id_hash: hashPluggyItemId(plaintext),
      connector_id: '001',
      institution_name: 'Banco Worker A',
      status: 'UPDATED',
    }).returning({ id: pluggy_items.id });

    const mockSvc = {
      fetchAccounts: vi.fn().mockResolvedValue({ results: [] }),
      fetchTransactions: vi.fn().mockResolvedValue({ results: [], next: null }),
    };
    vi.doMock('@/services/PluggyService', () => ({ getPluggyService: () => mockSvc }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    const before = Date.now();
    await pluggySyncWorker([
      { id: 'job-w-A', name: 'pluggy.sync', data: { item_id: item.id, trigger: 'manual' } } as never,
    ]);

    const [row] = await db
      .select({ last_manual_sync_at: pluggy_items.last_manual_sync_at })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, item.id));
    expect(row.last_manual_sync_at).toBeTruthy();
    expect(row.last_manual_sync_at!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('worker-B: trigger="webhook" does NOT write last_manual_sync_at', async () => {
    const db = await importDb();
    const { users, pluggy_items } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `worker-B-${Date.now()}-${Math.random()}@example.com`,
      password_hash: 'argon2id-placeholder',
      cpf_hash: randomBytes(32),
      cpf_enc: randomBytes(39),
      subscription_tier: 'paid',
    });

    const plaintext = `item-worker-B-${Date.now()}`;
    const [item] = await db.insert(pluggy_items).values({
      user_id: userId,
      pluggy_item_id_enc: encryptCPF(plaintext),
      pluggy_item_id_hash: hashPluggyItemId(plaintext),
      connector_id: '001',
      institution_name: 'Banco Worker B',
      status: 'UPDATED',
    }).returning({ id: pluggy_items.id });

    const mockSvc = {
      fetchAccounts: vi.fn().mockResolvedValue({ results: [] }),
      fetchTransactions: vi.fn().mockResolvedValue({ results: [], next: null }),
    };
    vi.doMock('@/services/PluggyService', () => ({ getPluggyService: () => mockSvc }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    await pluggySyncWorker([
      { id: 'job-w-B', name: 'pluggy.sync', data: { item_id: item.id, trigger: 'webhook' } } as never,
    ]);

    const [row] = await db
      .select({ last_manual_sync_at: pluggy_items.last_manual_sync_at, last_synced_at: pluggy_items.last_synced_at })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, item.id));
    expect(row.last_manual_sync_at).toBeNull();
    // last_synced_at IS still updated for all triggers — invariant preserved.
    expect(row.last_synced_at).toBeTruthy();
  });

  it('worker-C: trigger="manual" failure does NOT write last_manual_sync_at', async () => {
    const db = await importDb();
    const { users, pluggy_items } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `worker-C-${Date.now()}-${Math.random()}@example.com`,
      password_hash: 'argon2id-placeholder',
      cpf_hash: randomBytes(32),
      cpf_enc: randomBytes(39),
      subscription_tier: 'paid',
    });

    const plaintext = `item-worker-C-${Date.now()}`;
    const [item] = await db.insert(pluggy_items).values({
      user_id: userId,
      pluggy_item_id_enc: encryptCPF(plaintext),
      pluggy_item_id_hash: hashPluggyItemId(plaintext),
      connector_id: '001',
      institution_name: 'Banco Worker C',
      status: 'UPDATED',
    }).returning({ id: pluggy_items.id });

    const mockSvc = {
      fetchAccounts: vi.fn().mockRejectedValue(new Error('pluggy down')),
      fetchTransactions: vi.fn(),
    };
    vi.doMock('@/services/PluggyService', () => ({ getPluggyService: () => mockSvc }));

    const { pluggySyncWorker } = await import('@/jobs/workers/pluggySyncWorker');
    // Worker re-throws on failure (pg-boss retry); swallow to keep the test green.
    await expect(pluggySyncWorker([
      { id: 'job-w-C', name: 'pluggy.sync', data: { item_id: item.id, trigger: 'manual' } } as never,
    ])).rejects.toThrow();

    const [row] = await db
      .select({ last_manual_sync_at: pluggy_items.last_manual_sync_at })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, item.id));
    expect(row.last_manual_sync_at).toBeNull();
  });
});
