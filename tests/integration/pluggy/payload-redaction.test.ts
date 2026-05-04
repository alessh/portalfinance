/**
 * Integration test — webhook payload + pg-boss job payload redaction.
 *
 * Closes 02-REVIEWS.md Concern #1 (HIGH). Roadmap success criterion #6
 * forbids plaintext pluggy_item_id in DB state, which includes both
 * webhook_events.payload AND pg-boss job rows.
 *
 * Scenarios:
 *   redact-1: POST /api/webhooks/pluggy with body.itemId set →
 *     - webhook_events.payload->>'itemId' IS NULL
 *     - webhook_events.payload->>'itemIdHash' = HMAC hex of plaintext
 *     - PLUGGY_SYNC enqueue carries item_id_hash_hex and NOT item_id_pluggy
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
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const WEBHOOK_SECRET = 'redact-webhook-secret-at-least-32-chars';
const ITEM_ID_HASH_PEPPER = 'redact-item-id-pepper-at-least-32-chars';

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.CPF_HASH_PEPPER = 'redact-cpf-pepper-at-least-32-chars-xxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = ITEM_ID_HASH_PEPPER;
  process.env.NEXTAUTH_SECRET = 'redact-test-secret-at-least-32-chars-xx';
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

function makeRequest(body: unknown, sigHeader: string): Request {
  return new Request('http://localhost/api/webhooks/pluggy', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pluggy-signature': sigHeader,
    },
    body: JSON.stringify(body),
  });
}

describe('Pluggy webhook payload redaction (Concern #1)', () => {
  it('redact-1: replaces body.itemId with itemIdHash hex in webhook_events.payload AND in PLUGGY_SYNC job', async () => {
    const { POST } = await import('@/app/api/webhooks/pluggy/route');
    const boss = await import('@/jobs/boss');
    const { db } = await import('@/db');
    const { webhook_events } = await import('@/db/schema');
    const { hashPluggyItemId } = await import('@/lib/crypto');

    boss.drainQueue();

    const plaintext_item_id = `item-test-redact-${Date.now()}`;
    const event_id = `evt_redact_${Date.now()}`;
    const expected_hash_hex = hashPluggyItemId(plaintext_item_id).toString('hex');

    const res = await POST(
      makeRequest(
        { event: 'item/created', eventId: event_id, itemId: plaintext_item_id },
        WEBHOOK_SECRET,
      ),
    );
    expect(res.status).toBe(200);

    // (a) webhook_events.payload has NO plaintext itemId
    const [row] = await db
      .select({ payload: webhook_events.payload })
      .from(webhook_events)
      .where(eq(webhook_events.event_id, event_id));
    expect(row).toBeDefined();
    const payload = row.payload as Record<string, unknown>;
    expect(payload.itemId).toBeUndefined();
    expect(payload.itemIdHash).toBe(expected_hash_hex);

    // Belt-and-braces: stringify the JSON column and grep for the plaintext —
    // it MUST NOT appear anywhere in webhook_events.payload (Concern #1).
    expect(JSON.stringify(payload)).not.toContain(plaintext_item_id);

    // (b) PLUGGY_SYNC job carries item_id_hash_hex, NOT item_id_pluggy
    const queued = boss.peekQueue();
    const sync_job = queued.find(j => j.name === 'pluggy.sync');
    expect(sync_job).toBeDefined();
    expect(sync_job?.payload?.item_id_hash_hex).toBe(expected_hash_hex);
    expect(sync_job?.payload?.item_id_pluggy).toBeUndefined();
    // The plaintext itemId must NOT appear anywhere in the job payload either.
    expect(JSON.stringify(sync_job?.payload ?? {})).not.toContain(plaintext_item_id);
  });
});
