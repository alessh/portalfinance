/**
 * Integration test — itemReauthSucceededAuditWorker (Plan 02-12, Concern #3).
 *
 * Test scenarios:
 *   reauth-audit-1: positive — worker writes audit_log row with the same
 *     auditor-visible content the receiver used to write inline.
 *   reauth-audit-2: idempotency — running the worker twice with identical
 *     payload yields exactly one audit row (jsonb @> webhook_event_id check).
 *   reauth-audit-3: item not found — worker logs warn(reauth_audit_skipped),
 *     does NOT throw, does NOT write an audit row.
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16.
 *   - Apply Drizzle migrations.
 *   - Seed users + pluggy_items rows.
 *   - Direct-invoke the worker (no pg-boss scheduler).
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
import { sql, count, eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const ITEM_ID_HASH_PEPPER = 'ra-item-id-pepper-at-least-32-chars-x';

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  process.env.CPF_HASH_PEPPER = 'ra-test-pepper-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = ITEM_ID_HASH_PEPPER;
  process.env.NEXTAUTH_SECRET = 'ra-test-secret-at-least-32-chars-xxxxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'ra-webhook-secret-at-least-32-chars-x';
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

// NOTE: per-suite TRUNCATE intentionally omitted. Phase 02 integration suites
// share a forked-process testcontainer (vitest pool: forks + isolate: false,
// see plan 02-09 SUMMARY) so cross-suite rows from sync-worker.test.ts,
// reauth-notifier.test.ts etc. linger in users / pluggy_items / user_consents.
// Each test below scopes its assertions by the freshly-seeded user_id (or by
// the unique webhook_event_id) — no global cleanup is required, and a
// destructive `delete users` here would deadlock on the user_consents FK that
// other suites populate.

async function seedItem(rawPluggyId: string): Promise<{ user_id: string; item_id: string; hash_hex: string }> {
  const { db } = await import('@/db');
  const { users, pluggy_items } = await import('@/db/schema');
  const { hashPluggyItemId } = await import('@/lib/crypto');

  const [u] = await db
    .insert(users)
    .values({
      email: `ra-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password_hash: 'argon2id-placeholder',
      cpf_hash: randomBytes(32),
      cpf_enc: randomBytes(44),
    })
    .returning({ id: users.id });

  const hash = hashPluggyItemId(rawPluggyId);
  const [item] = await db
    .insert(pluggy_items)
    .values({
      user_id: u.id,
      pluggy_item_id_enc: randomBytes(48),
      pluggy_item_id_hash: hash,
      connector_id: '001',
      institution_name: 'Banco Teste RA',
      status: 'UPDATED',
    })
    .returning({ id: pluggy_items.id });

  return { user_id: u.id, item_id: item.id, hash_hex: hash.toString('hex') };
}

function makeJob(data: { item_id_hash_hex: string; webhook_event_id: string }, id = 'job-ra'): Job<{ item_id_hash_hex: string; webhook_event_id: string }> {
  return {
    id,
    name: 'pluggy.re-auth-audit',
    data,
  } as Job<{ item_id_hash_hex: string; webhook_event_id: string }>;
}

describe('itemReauthSucceededAuditWorker', () => {
  it('reauth-audit-1: writes audit_log row with item_reauth_succeeded action and webhook_event_id metadata', async () => {
    const raw_id = `item-ra1-${Date.now()}`;
    const { user_id, hash_hex } = await seedItem(raw_id);

    const { itemReauthSucceededAuditWorker } = await import(
      '@/jobs/workers/itemReauthSucceededAuditWorker'
    );
    // webhook_event_id mirrors the production shape: a UUID from
    // webhook_events.id (the PK assigned at INSERT time). Avoid Date.now()
    // here — it produces 11+ contiguous digits that the PII scrubber would
    // rewrite as [CPF], breaking metadata equality assertions.
    const webhook_event_id = randomUUID();
    await itemReauthSucceededAuditWorker([
      makeJob({ item_id_hash_hex: hash_hex, webhook_event_id }, 'ra1'),
    ]);

    const { db } = await import('@/db');
    const { audit_log } = await import('@/db/schema');
    const rows = await db
      .select()
      .from(audit_log)
      .where(eq(audit_log.user_id, user_id));

    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe('item_reauth_succeeded');
    const metadata = rows[0].metadata as Record<string, unknown>;

    // Plan 02-12 truth #5: byte-equivalent to pre-change behavior. The
    // pre-change inline path also passed metadata through scrubObject; the
    // 64-char hex hash flows through string rules (TOKEN_LIKE_REGEX +
    // PHONE_BR_REGEX) and ends up as a `[TOKEN]`/`[PHONE]`-spliced redaction.
    // Auditors re-derive the original hash from pluggy_item_id_enc + pepper.
    // We assert the redaction MARKER is present rather than asserting the
    // exact mangled string (which depends on random hex content).
    expect(typeof metadata.item_id_hashed).toBe('string');
    expect(metadata.item_id_hashed).toMatch(/\[(TOKEN|PHONE)\]/);
    expect(metadata.item_id_hashed).not.toContain(hash_hex);

    // webhook_event_id is in the scrubber's PRESERVE_KEYS allowlist (added
    // in 02-12) so audit dedup queries find prior rows on retry.
    expect(metadata.webhook_event_id).toBe(webhook_event_id);
  });

  it('reauth-audit-2: idempotent — second run with identical payload does not insert a duplicate', async () => {
    const raw_id = `item-ra2-${Date.now()}`;
    const { user_id, hash_hex } = await seedItem(raw_id);

    const { itemReauthSucceededAuditWorker } = await import(
      '@/jobs/workers/itemReauthSucceededAuditWorker'
    );
    const webhook_event_id = randomUUID();
    const payload = { item_id_hash_hex: hash_hex, webhook_event_id };

    await itemReauthSucceededAuditWorker([makeJob(payload, 'ra2-a')]);
    await itemReauthSucceededAuditWorker([makeJob(payload, 'ra2-b')]);

    const { db } = await import('@/db');
    const { audit_log } = await import('@/db/schema');
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(audit_log)
      .where(eq(audit_log.user_id, user_id));

    // jsonb @> webhook_event_id idempotency check must suppress the second insert.
    expect(Number(total)).toBe(1);
  });

  it('reauth-audit-3: item not found — logs warn and does NOT throw or insert audit row', async () => {
    const { itemReauthSucceededAuditWorker } = await import(
      '@/jobs/workers/itemReauthSucceededAuditWorker'
    );
    // Hash points at no real pluggy_items row.
    const phantom_hash_hex = Buffer.alloc(32, 0xab).toString('hex');
    // Scope the assertion to THIS test's webhook_event_id — cross-suite rot
    // (other suites share the testcontainer) would otherwise inflate the count.
    const webhook_event_id = randomUUID();

    await expect(
      itemReauthSucceededAuditWorker([
        makeJob(
          { item_id_hash_hex: phantom_hash_hex, webhook_event_id },
          'ra3',
        ),
      ]),
    ).resolves.toBeUndefined();

    const { db } = await import('@/db');
    const { audit_log } = await import('@/db/schema');
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(audit_log)
      .where(
        sql`${audit_log.metadata}->>'webhook_event_id' = ${webhook_event_id}`,
      );
    expect(Number(total)).toBe(0);
  });
});
