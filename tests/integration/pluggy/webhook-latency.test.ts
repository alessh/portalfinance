/**
 * Integration test — webhook receiver latency regression (Plan 02-12, Concern #3).
 *
 * Closes codex review concern #3 (HIGH — receiver hot-path may breach <200ms
 * latency target under load): plan 02-12 moves the inline DB lookup +
 * `recordAudit()` for `item/login_succeeded` events out of the receiver into
 * `itemReauthSucceededAuditWorker` on `PLUGGY_REAUTH_AUDIT`. This test guards
 * the budget so a future regression that puts work back on the hot path
 * (extra DB selects, dynamic imports of audit code, sync emits) fails CI.
 *
 * Threshold: 200ms median across 10 sequential POSTs. The Pluggy spec budget
 * is 5s; CONTEXT.md D-37 § Webhook receiver structure caps our internal
 * target at <200ms; production p95 is expected far below 50ms. The
 * testcontainers Postgres + Windows Docker base latency adds ~100ms vs
 * production, so 200ms remains a meaningful gate on testcontainer infra
 * (pre-fix latency was ~250-400ms with the inline audit, well above 200ms).
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

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const WEBHOOK_SECRET = 'wl-webhook-secret-at-least-32-chars-x';

beforeAll(async () => {
  td = await startTestDb();

  // Set env BEFORE module imports — vitest module registry caches env at
  // import time, mirroring the pattern in webhook.test.ts.
  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  process.env.CPF_HASH_PEPPER = 'wl-cpf-pepper-at-least-32-chars-xxxxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'wl-item-id-pepper-at-least-32-chars-x';
  process.env.NEXTAUTH_SECRET = 'wl-test-secret-at-least-32-chars-xxxxxx';
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

async function importRouteHandler() {
  const mod = await import('@/app/api/webhooks/pluggy/route');
  return mod.POST;
}

async function importDb() {
  const { db } = await import('@/db');
  return db;
}

/** Seed a users + pluggy_items row keyed by `rawPluggyId`. */
async function seedItem(rawPluggyId: string): Promise<void> {
  const db = await importDb();
  const { users, pluggy_items } = await import('@/db/schema');
  const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

  const [u] = await db
    .insert(users)
    .values({
      email: `wl-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password_hash: 'argon2id-placeholder',
      cpf_hash: randomBytes(32),
      cpf_enc: randomBytes(44),
      subscription_tier: 'paid',
    })
    .returning({ id: users.id });

  await db.insert(pluggy_items).values({
    user_id: u.id,
    pluggy_item_id_enc: encryptCPF(rawPluggyId),
    pluggy_item_id_hash: hashPluggyItemId(rawPluggyId),
    connector_id: '001',
    institution_name: 'Banco Latency',
    status: 'UPDATED',
  });
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/webhooks/pluggy', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pluggy-signature': WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });
}

describe('Pluggy webhook latency (Concern #3 closure)', () => {
  it('returns 200 in <200ms median across 10 sequential item/login_succeeded posts', async () => {
    const handler = await importRouteHandler();
    const boss = await import('@/jobs/boss');
    boss.drainQueue();

    // One seeded item — the receiver enqueues PLUGGY_REAUTH_AUDIT for each
    // post and the worker (deferred, not invoked here) would resolve via
    // pluggy_item_id_hash. We don't run the worker — this test isolates the
    // receiver's hot-path latency.
    const seedRawId = `item-latency-${Date.now()}`;
    await seedItem(seedRawId);

    const latencies: number[] = [];
    for (let i = 0; i < 10; i++) {
      const req = makeRequest({
        event: 'item/login_succeeded',
        eventId: `evt_latency_${Date.now()}_${i}`,
        itemId: seedRawId,
      });
      const t0 = Date.now();
      const resp = await handler(req);
      const elapsed = Date.now() - t0;
      latencies.push(elapsed);
      expect(resp.status).toBe(200);
    }

    latencies.sort((a, b) => a - b);
    const median = latencies[Math.floor(latencies.length / 2)];

    // Concern #3: receiver should now be lookup-free + audit-free for this
    // event. Budget = CONTEXT.md webhook latency target = 200ms.
    // production p95 expected < 50ms; testcontainer adds ~100ms base latency
    // — using the 200ms criterion target avoids flap risk while still
    // catching regressions (pre-fix latency was ~250-400ms with inline audit).
    expect(
      median,
      `median latency ${median}ms exceeds 200ms target — latencies=${latencies.join(',')}`,
    ).toBeLessThan(200);
  });
});
