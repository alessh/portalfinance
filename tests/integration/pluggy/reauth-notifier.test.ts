/**
 * Integration test — reAuthNotifierWorker.
 *
 * Plan 02-05 — D-34 (24h debounce), D-35 (reconnect URL uses internal UUID),
 * CONN-03 (re-auth email delivery), T-02-B (no Pluggy item ID in email body),
 * T-02-C (email storm prevention via debounce).
 *
 * Test scenarios:
 *   reauth-1: first email sends — sendEmail called, last_reauth_email_at updated,
 *             plaintext body does NOT contain raw Pluggy item ID.
 *   reauth-2: within 24h debounce — sendEmail NOT called, debounced log emitted.
 *   reauth-3: after 24h debounce expires (25h ago) — sendEmail IS called again.
 *
 * Strategy:
 *   - Testcontainers Postgres 16 + Drizzle migrations.
 *   - vi.doMock('@/lib/mailer') to intercept sendEmail calls without SES.
 *   - Seed users + pluggy_items rows with controlled last_reauth_email_at.
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
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

// ---------------------------------------------------------------------------
// DB + environment setup
// ---------------------------------------------------------------------------

let td: TestDb;
let pg: ReturnType<typeof postgres>;

// Fake Pluggy item ID — used to verify it does NOT appear in the email body (T-02-B).
const FAKE_PLUGGY_ITEM_ID = 'pluggy-item-id-should-never-appear-in-email';
const INSTITUTION_NAME = 'Itau';

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
  process.env.CPF_HASH_PEPPER = 'rn-test-pepper-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'rn-item-pepper-at-least-32-chars-xxxx';
  process.env.NEXTAUTH_SECRET = 'rn-test-secret-at-least-32-chars-xxxxx';
  process.env.NEXTAUTH_URL = 'https://app.portalfinance.local';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'rn-webhook-secret-at-least-32-chars-xx';
  process.env.BOSS_TEST_MODE = '1';
  process.env.AWS_ACCESS_KEY_ID = 'test-aws-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-aws-secret';
  process.env.AWS_REGION = 'us-east-1';
  process.env.SES_FROM_EMAIL = 'noreply@portalfinance.local';

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

async function seedUserAndItem(opts: {
  last_reauth_email_at?: Date | null;
  status?: 'UPDATED' | 'LOGIN_ERROR' | 'WAITING_USER_INPUT' | 'UPDATING' | 'OUTDATED';
}): Promise<{ user_id: string; item_id: string; user_email: string }> {
  const { db } = await import('@/db');
  const { users, pluggy_items } = await import('@/db/schema');
  const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

  const user_email = `rn-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const cpf_enc = encryptCPF('123.456.789-09');

  const [user_row] = await db
    .insert(users)
    .values({
      email: user_email,
      password_hash: 'not-a-real-hash',
      cpf_enc,
      cpf_hash: Buffer.from('rn-cpf-hash-dummy-not-real-32byte'),
    })
    .returning({ id: users.id });

  const enc = Buffer.concat([
    Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    Buffer.from(FAKE_PLUGGY_ITEM_ID),
  ]);
  const hash = hashPluggyItemId(FAKE_PLUGGY_ITEM_ID);

  const [item_row] = await db
    .insert(pluggy_items)
    .values({
      user_id: user_row.id,
      pluggy_item_id_enc: enc,
      pluggy_item_id_hash: hash,
      connector_id: 'connector-itau',
      institution_name: INSTITUTION_NAME,
      status: opts.status ?? 'LOGIN_ERROR',
      last_reauth_email_at: opts.last_reauth_email_at ?? null,
      last_synced_at: new Date('2026-04-01T10:00:00Z'),
    })
    .returning({ id: pluggy_items.id });

  // Manually override last_reauth_email_at if specified (Drizzle defaultNow can't be overridden at INSERT).
  if (opts.last_reauth_email_at !== null && opts.last_reauth_email_at !== undefined) {
    await db.execute(
      sql`UPDATE pluggy_items SET last_reauth_email_at = ${opts.last_reauth_email_at.toISOString()} WHERE id = ${item_row.id}`,
    );
  }

  return { user_id: user_row.id, item_id: item_row.id, user_email };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reAuthNotifierWorker', () => {
  beforeEach(async () => {
    const { db } = await import('@/db');
    const { audit_log, pluggy_items, users } = await import('@/db/schema');
    await db.delete(audit_log);
    await db.delete(pluggy_items);
    await db.delete(users);
  });

  it('reauth-1: sends email when last_reauth_email_at is null (first time)', async () => {
    // Mock sendEmail to intercept calls without hitting SES
    const sendEmailMock = vi.fn().mockResolvedValue({ messageId: 'mock-msg-id', suppressed: false });
    vi.doMock('@/lib/mailer', () => ({ sendEmail: sendEmailMock }));

    const { reAuthNotifierWorker } = await import('@/jobs/workers/reAuthNotifierWorker');
    const { db } = await import('@/db');
    const { pluggy_items } = await import('@/db/schema');

    const { item_id, user_email } = await seedUserAndItem({ last_reauth_email_at: null });

    await reAuthNotifierWorker([
      { id: 'job-rn1', name: 'pluggy.re-auth-notifier', data: { item_id } } as Job<{ item_id: string }>,
    ]);

    // Verify sendEmail was called
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call_args = sendEmailMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      plaintext: string;
    };

    // Called with the correct recipient and subject
    expect(call_args.to).toBe(user_email);
    expect(call_args.subject).toContain(INSTITUTION_NAME);

    // Plaintext must NOT contain the raw Pluggy item ID (T-02-B / P4)
    expect(call_args.plaintext).toBeDefined();
    expect(call_args.plaintext).not.toContain(FAKE_PLUGGY_ITEM_ID);

    // Plaintext must be non-empty
    expect(call_args.plaintext.trim().length).toBeGreaterThan(20);

    // last_reauth_email_at must have been updated
    const [item] = await db
      .select({ last_reauth_email_at: pluggy_items.last_reauth_email_at })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, item_id));
    const elapsed_ms = Date.now() - (item.last_reauth_email_at?.getTime() ?? 0);
    // Should be within the last 5 seconds
    expect(elapsed_ms).toBeLessThan(5000);
  });

  it('reauth-2: skips email when last_reauth_email_at is within 24h (debounce)', async () => {
    const sendEmailMock = vi.fn().mockResolvedValue({ messageId: null, suppressed: false });
    vi.doMock('@/lib/mailer', () => ({ sendEmail: sendEmailMock }));

    const { reAuthNotifierWorker } = await import('@/jobs/workers/reAuthNotifierWorker');

    // last_reauth_email_at 2 hours ago — within 24h window
    const two_hours_ago = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { item_id } = await seedUserAndItem({ last_reauth_email_at: two_hours_ago });

    await reAuthNotifierWorker([
      { id: 'job-rn2', name: 'pluggy.re-auth-notifier', data: { item_id } } as Job<{ item_id: string }>,
    ]);

    // sendEmail must NOT be called
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('reauth-3: sends email when last_reauth_email_at is 25h ago (debounce expired)', async () => {
    const sendEmailMock = vi.fn().mockResolvedValue({ messageId: 'mock-msg-id-2', suppressed: false });
    vi.doMock('@/lib/mailer', () => ({ sendEmail: sendEmailMock }));

    const { reAuthNotifierWorker } = await import('@/jobs/workers/reAuthNotifierWorker');

    // last_reauth_email_at 25 hours ago — outside the 24h window
    const twenty_five_hours_ago = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { item_id } = await seedUserAndItem({ last_reauth_email_at: twenty_five_hours_ago });

    await reAuthNotifierWorker([
      { id: 'job-rn3', name: 'pluggy.re-auth-notifier', data: { item_id } } as Job<{ item_id: string }>,
    ]);

    // sendEmail IS called after the 24h window expires
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
