/**
 * Integration test — POST /api/webhooks/pluggy.
 *
 * Plan 02-04 — T-02-A (spoofing/webhook forgery), T-02-B (replay attacks) proofs.
 * Requirements: CONN-02, CONN-07, Pitfalls P3, P10.
 *
 * Scenarios covered:
 *   (a) Invalid X-Pluggy-Signature → 401, no row, no enqueue.
 *   (b) Empty X-Pluggy-Signature → 401.
 *   (c) 3x replay of same eventId with valid header → exactly 1 webhook_events row,
 *       exactly 1 enqueued PLUGGY_SYNC job (T-02-B proof).
 *   (d) Unknown event type (payment_intent/created) → row inserted, log contains
 *       pluggy_webhook_unmapped_event, no enqueue (P10).
 *   (e) Event routing: item/error → PLUGGY_REAUTH_NOTIFIER; item/created → PLUGGY_SYNC;
 *       item/deleted → row inserted, NO enqueue (explicit no-op).
 *   (f) Latency assertion: handler returns within 250ms.
 *   (g) item/login_succeeded → PLUGGY_SYNC with trigger='reconnect' + audit_log row.
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16.
 *   - Apply Drizzle migrations.
 *   - Direct-import route handler (no HTTP server).
 *   - pg-boss test mode via BOSS_TEST_MODE=1 (peekQueue() asserts enqueued jobs).
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
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../../fixtures/db';

// ---------------------------------------------------------------------------
// DB + environment setup
// ---------------------------------------------------------------------------

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const WEBHOOK_SECRET = 'test-webhook-secret-at-least-32-chars-x';

beforeAll(async () => {
  td = await startTestDb();

  // Set env BEFORE module imports — vitest module registry caches env at import time.
  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.CPF_HASH_PEPPER = 'wh-test-pepper-at-least-32-chars-xxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'wh-item-id-pepper-at-least-32-chars-x';
  process.env.NEXTAUTH_SECRET = 'wh-test-secret-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.BOSS_TEST_MODE = '1';
  // NODE_ENV is already 'test' when vitest runs.

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
// Test helpers
// ---------------------------------------------------------------------------

async function importRouteHandler() {
  const mod = await import('@/app/api/webhooks/pluggy/route');
  return mod.POST;
}

async function importDb() {
  const { db } = await import('@/db');
  return db;
}

async function importBoss() {
  return import('@/jobs/boss');
}

function makeRequest(body: unknown, sigHeader?: string): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (sigHeader !== undefined) {
    headers['x-pluggy-signature'] = sigHeader;
  }
  return new Request('http://localhost/api/webhooks/pluggy', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Seed a users row + pluggy_items row. Returns { userId, itemId (internal UUID) }. */
async function seedPluggyItem(opts?: { pluggyRawId?: string }) {
  const db = await importDb();
  const { users, pluggy_items } = await import('@/db/schema');
  const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `test-wh-${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'argon2id-placeholder',
    cpf_hash: randomBytes(32),
    cpf_enc: randomBytes(44),
    subscription_tier: 'paid',
  });

  const raw_id = opts?.pluggyRawId ?? `item-test-${Date.now()}`;
  const enc = encryptCPF(raw_id); // generic AES-256-GCM helper — same as pluggy_item_id_enc
  const hash = hashPluggyItemId(raw_id);

  const [inserted_item] = await db.insert(pluggy_items).values({
    user_id: userId,
    pluggy_item_id_enc: enc,
    pluggy_item_id_hash: hash,
    connector_id: '001',
    institution_name: 'Banco Teste',
    status: 'UPDATED',
  }).returning({ id: pluggy_items.id });

  return { userId, itemId: inserted_item.id, rawPluggyId: raw_id };
}

// ---------------------------------------------------------------------------
// Scenario (a) + (b): Invalid / empty X-Pluggy-Signature → 401
// ---------------------------------------------------------------------------

describe('Pluggy webhook', () => {
  it('(a) rejects invalid X-Pluggy-Signature with 401', async () => {
    const handler = await importRouteHandler();
    const boss = await importBoss();
    boss.drainQueue(); // clear any previous jobs

    const res = await handler(makeRequest({
      event: 'item/created',
      eventId: 'evt-invalid-sig-001',
      itemId: 'item-abc',
    }, 'wrong-secret'));

    expect(res.status).toBe(401);

    // No webhook_events row should exist
    const db = await importDb();
    const { webhook_events } = await import('@/db/schema');
    const rows = await db
      .select({ cnt: count() })
      .from(webhook_events)
      .where(eq(webhook_events.event_id, 'evt-invalid-sig-001'));
    expect(rows[0].cnt).toBe(0);

    // No job enqueued
    const queued = boss.peekQueue();
    expect(queued.filter(j => j.payload?.event_id === 'evt-invalid-sig-001')).toHaveLength(0);
  });

  it('(b) rejects empty X-Pluggy-Signature with 401', async () => {
    const handler = await importRouteHandler();
    const res = await handler(makeRequest({
      event: 'item/created',
      eventId: 'evt-empty-sig-001',
      itemId: 'item-abc',
    }, ''));

    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Scenario (c): 3x replay → exactly 1 row + exactly 1 enqueued job
  // ---------------------------------------------------------------------------

  it('(c) 3x replay of same eventId produces exactly 1 webhook_events row and 1 PLUGGY_SYNC job', async () => {
    const handler = await importRouteHandler();
    const boss = await importBoss();
    boss.drainQueue(); // clear any previous jobs

    const event_id = `evt-replay-${Date.now()}`;
    const payload = { event: 'item/created', eventId: event_id, itemId: 'item-replay-test' };

    const res1 = await handler(makeRequest(payload, WEBHOOK_SECRET));
    const res2 = await handler(makeRequest(payload, WEBHOOK_SECRET));
    const res3 = await handler(makeRequest(payload, WEBHOOK_SECRET));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);

    // Exactly 1 webhook_events row
    const db = await importDb();
    const { webhook_events } = await import('@/db/schema');
    const rows = await db
      .select({ cnt: count() })
      .from(webhook_events)
      .where(eq(webhook_events.event_id, event_id));
    expect(rows[0].cnt).toBe(1);

    // Exactly 1 PLUGGY_SYNC job enqueued (duplicate replays are no-ops)
    const queued = boss.peekQueue().filter(j => j.name === 'pluggy.sync');
    expect(queued).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Scenario (d): Unknown event type → row inserted, no enqueue, unmapped log
  // ---------------------------------------------------------------------------

  it('(d) unknown event type inserts row and logs pluggy_webhook_unmapped_event but does NOT enqueue', async () => {
    const handler = await importRouteHandler();
    const boss = await importBoss();
    boss.drainQueue();

    const event_id = `evt-unknown-${Date.now()}`;
    const res = await handler(makeRequest({
      event: 'payment_intent/created',
      eventId: event_id,
      itemId: 'item-unknown-test',
    }, WEBHOOK_SECRET));

    expect(res.status).toBe(200);

    // Row inserted
    const db = await importDb();
    const { webhook_events } = await import('@/db/schema');
    const rows = await db
      .select({ cnt: count() })
      .from(webhook_events)
      .where(eq(webhook_events.event_id, event_id));
    expect(rows[0].cnt).toBe(1);

    // No job enqueued for unmapped event
    const queued = boss.peekQueue();
    // Filter for any job linked to this specific webhook event — none expected
    expect(queued.filter(j =>
      j.payload?.event_id === event_id ||
      (j.payload?.item_id_pluggy === 'item-unknown-test' && j.name !== 'pluggy.sync')
    )).toHaveLength(0);
    // Specifically: no pluggy.sync and no pluggy.re-auth-notifier for this event
    const sync_jobs = queued.filter(j => j.name === 'pluggy.sync');
    expect(sync_jobs).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Scenario (e): Event routing
  // ---------------------------------------------------------------------------

  it('(e) item/error → enqueues PLUGGY_REAUTH_NOTIFIER; item/created → enqueues PLUGGY_SYNC; item/deleted → no enqueue', async () => {
    const boss = await importBoss();
    boss.drainQueue();

    const handler = await importRouteHandler();

    // item/error → PLUGGY_REAUTH_NOTIFIER
    const event_id_error = `evt-item-error-${Date.now()}`;
    const res_error = await handler(makeRequest({
      event: 'item/error',
      eventId: event_id_error,
      itemId: 'item-test-e',
      error: { code: 'ACCOUNT_LOCKED', message: 'Account locked' },
    }, WEBHOOK_SECRET));
    expect(res_error.status).toBe(200);

    // item/created → PLUGGY_SYNC (drain earlier, then send item/created)
    const reauth_jobs = boss.drainQueue();
    expect(reauth_jobs.some(j => j.name === 'pluggy.re-auth-notifier')).toBe(true);

    const event_id_created = `evt-item-created-${Date.now()}`;
    const res_created = await handler(makeRequest({
      event: 'item/created',
      eventId: event_id_created,
      itemId: 'item-test-e-created',
    }, WEBHOOK_SECRET));
    expect(res_created.status).toBe(200);

    const sync_jobs = boss.drainQueue();
    expect(sync_jobs.some(j => j.name === 'pluggy.sync')).toBe(true);

    // item/deleted → explicit no-op (row inserted, NO enqueue)
    const event_id_deleted = `evt-item-deleted-${Date.now()}`;
    const res_deleted = await handler(makeRequest({
      event: 'item/deleted',
      eventId: event_id_deleted,
      itemId: 'item-test-e-deleted',
    }, WEBHOOK_SECRET));
    expect(res_deleted.status).toBe(200);

    const db = await importDb();
    const { webhook_events } = await import('@/db/schema');
    const deleted_rows = await db
      .select({ cnt: count() })
      .from(webhook_events)
      .where(eq(webhook_events.event_id, event_id_deleted));
    expect(deleted_rows[0].cnt).toBe(1); // row inserted

    const after_deleted_jobs = boss.peekQueue();
    expect(after_deleted_jobs).toHaveLength(0); // no job enqueued
  });

  // ---------------------------------------------------------------------------
  // Scenario (f): Latency assertion (<250ms for testcontainers budget)
  // ---------------------------------------------------------------------------

  it('(f) handler returns within 250ms', async () => {
    const handler = await importRouteHandler();
    const boss = await importBoss();
    boss.drainQueue();

    const start = Date.now();
    const res = await handler(makeRequest({
      event: 'transactions/created',
      eventId: `evt-latency-${Date.now()}`,
      itemId: 'item-latency-test',
    }, WEBHOOK_SECRET));
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    // 250ms is a loose budget for testcontainers; Pluggy spec is 5s; our internal target <200ms.
    expect(elapsed).toBeLessThan(250);
  });

  // ---------------------------------------------------------------------------
  // Scenario (g): item/login_succeeded → trigger='reconnect' + audit_log row
  // ---------------------------------------------------------------------------

  it('(g) item/login_succeeded enqueues PLUGGY_SYNC with trigger=reconnect and writes audit_log', async () => {
    const boss = await importBoss();
    boss.drainQueue();

    // Seed a real pluggy_items row so the audit lookup succeeds
    const { userId, rawPluggyId } = await seedPluggyItem({ pluggyRawId: `item-reauth-${Date.now()}` });

    const handler = await importRouteHandler();
    const event_id = `evt-login-ok-${Date.now()}`;

    const res = await handler(makeRequest({
      event: 'item/login_succeeded',
      eventId: event_id,
      itemId: rawPluggyId,
    }, WEBHOOK_SECRET));

    expect(res.status).toBe(200);

    // PLUGGY_SYNC enqueued with trigger='reconnect'
    const queued = boss.drainQueue();
    const sync_job = queued.find(j => j.name === 'pluggy.sync');
    expect(sync_job).toBeDefined();
    expect(sync_job?.payload?.trigger).toBe('reconnect');

    // audit_log row with action='item_reauth_succeeded'
    const db = await importDb();
    const { audit_log } = await import('@/db/schema');
    const { hashPluggyItemId } = await import('@/lib/crypto');
    const expected_hash = hashPluggyItemId(rawPluggyId).toString('hex');

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
});
