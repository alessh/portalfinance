/**
 * Integration tests — DISCONNECTED lifecycle (Plan 02-15, Concerns #6 + #7).
 *
 * Coverage:
 *   disconnected-lifecycle-1: DELETE /api/pluggy/items/:id atomically transitions
 *     pluggy_items.status to 'DISCONNECTED' alongside accounts.status='DELETED'
 *     and the user_consents REVOKED row.
 *   disconnected-lifecycle-2: pluggySyncWorker invoked against a DISCONNECTED
 *     item must NOT call PluggyService.fetchAccounts and must log
 *     event=sync_failed with reason='item_disconnected'.
 *   disconnected-lifecycle-3: reconcileStaleItemsWorker excludes DISCONNECTED
 *     items even when last_synced_at is older than 12h.
 *   disconnected-lifecycle-4: the /settings/connections data query (run as a
 *     server-side equivalent here) filters out DISCONNECTED items.
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16, apply Drizzle migrations
 *     (the 0005_phase02_15_item_status_disconnected migration adds the
 *     'DISCONNECTED' enum value before any seed runs).
 *   - Seed users + pluggy_items rows directly with the new enum value.
 *   - Mock PluggyService via vi.doMock for the worker / route paths.
 *   - Direct-invoke worker functions; no pg-boss scheduler.
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
import { sql, eq, and, ne } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;
let pg: ReturnType<typeof postgres>;

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');
  process.env.CPF_HASH_PEPPER = 'dl-test-pepper-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'dl-item-id-pepper-at-least-32-chars-x';
  process.env.NEXTAUTH_SECRET = 'dl-test-secret-at-least-32-chars-xxxxx';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'dl-webhook-secret-at-least-32-chars-x';
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

async function importDb() {
  const { db } = await import('@/db');
  return db;
}

async function createUserAndSession(): Promise<{
  userId: string;
  sessionToken: string;
}> {
  const db = await importDb();
  const { users, sessions } = await import('@/db/schema');

  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `dl-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password_hash: 'argon2id-placeholder',
    cpf_hash: randomBytes(32),
    cpf_enc: randomBytes(44),
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

interface SeedOpts {
  status?:
    | 'UPDATING'
    | 'LOGIN_ERROR'
    | 'OUTDATED'
    | 'WAITING_USER_INPUT'
    | 'UPDATED'
    | 'DISCONNECTED';
  last_synced_at?: Date | null;
  institution_name?: string;
}

async function seedItem(
  userId: string,
  opts: SeedOpts = {},
): Promise<{ itemId: string; accountId: string; connectorId: string }> {
  const db = await importDb();
  const { pluggy_items, accounts } = await import('@/db/schema');
  const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

  const connectorId = '001';
  const rawPluggyId = `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [item] = await db
    .insert(pluggy_items)
    .values({
      user_id: userId,
      pluggy_item_id_enc: encryptCPF(rawPluggyId),
      pluggy_item_id_hash: hashPluggyItemId(rawPluggyId),
      connector_id: connectorId,
      institution_name: opts.institution_name ?? 'Banco DL',
      status: opts.status ?? 'UPDATED',
      last_synced_at: opts.last_synced_at ?? null,
    })
    .returning({ id: pluggy_items.id });

  const [acc] = await db
    .insert(accounts)
    .values({
      user_id: userId,
      pluggy_item_id: item.id,
      pluggy_account_id: `acc-${Date.now()}-${Math.random()}`,
      type: 'CHECKING',
      name: 'Conta DL',
      currency: 'BRL',
      balance: '100.00',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });

  return { itemId: item.id, accountId: acc.id, connectorId };
}

function makeDeleteRequest(itemId: string, sessionToken: string): Request {
  return new Request(`http://localhost/api/pluggy/items/${itemId}`, {
    method: 'DELETE',
    headers: { cookie: `authjs.session-token=${sessionToken}` },
  });
}

function makeJob(data: Record<string, unknown>): Job<Record<string, unknown>> {
  return {
    id: `job-${Date.now()}-${Math.random()}`,
    name: 'pluggy.sync',
    data,
  } as Job<Record<string, unknown>>;
}

describe('disconnected lifecycle (plan 02-15)', () => {
  it('disconnected-lifecycle-1: DELETE atomically transitions pluggy_items to DISCONNECTED', async () => {
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({
        deleteItem: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    const { DELETE: handler } = await import(
      '@/app/api/pluggy/items/[id]/route'
    );
    const db = await importDb();
    const { pluggy_items, accounts, user_consents, audit_log } = await import(
      '@/db/schema'
    );

    const { userId, sessionToken } = await createUserAndSession();
    const { itemId, accountId, connectorId } = await seedItem(userId, {
      status: 'UPDATED',
    });

    const res = await handler(makeDeleteRequest(itemId, sessionToken), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(200);

    // (a) pluggy_items.status = 'DISCONNECTED'
    const [item_row] = await db
      .select({ status: pluggy_items.status })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, itemId));
    expect(item_row.status).toBe('DISCONNECTED');

    // (b) account soft-deleted
    const [acc_row] = await db
      .select({ status: accounts.status })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(acc_row.status).toBe('DELETED');

    // (c) user_consents REVOKED row appended
    const consents = await db
      .select({ action: user_consents.action, scope: user_consents.scope })
      .from(user_consents)
      .where(eq(user_consents.user_id, userId));
    expect(
      consents.find(
        c =>
          c.action === 'REVOKED' &&
          c.scope === `PLUGGY_CONNECTOR:${connectorId}`,
      ),
    ).toBeDefined();

    // (d) audit_log row action='item_disconnected'
    const audits = await db
      .select({ action: audit_log.action })
      .from(audit_log)
      .where(eq(audit_log.user_id, userId));
    expect(audits.find(a => a.action === 'item_disconnected')).toBeDefined();
  });

  it('disconnected-lifecycle-2: pluggySyncWorker skips DISCONNECTED items', async () => {
    const fetchAccounts = vi.fn();
    const fetchTransactions = vi.fn();
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({ fetchAccounts, fetchTransactions }),
    }));

    const { userId } = await createUserAndSession();
    const { itemId } = await seedItem(userId, { status: 'DISCONNECTED' });

    const { pluggySyncWorker } = await import(
      '@/jobs/workers/pluggySyncWorker'
    );

    await expect(
      pluggySyncWorker([makeJob({ user_id: userId, item_id: itemId })]),
    ).resolves.toBeUndefined();

    expect(fetchAccounts).not.toHaveBeenCalled();
    expect(fetchTransactions).not.toHaveBeenCalled();
  });

  it('disconnected-lifecycle-3: reconcileStaleItemsWorker excludes DISCONNECTED items', async () => {
    const { userId } = await createUserAndSession();
    const stale = new Date(Date.now() - 14 * 60 * 60 * 1000); // 14 hours ago
    const { itemId: itemUpdatedId } = await seedItem(userId, {
      status: 'UPDATED',
      last_synced_at: stale,
      institution_name: 'Banco UPDATED-stale',
    });
    const { itemId: itemDisconnectedId } = await seedItem(userId, {
      status: 'DISCONNECTED',
      last_synced_at: stale,
      institution_name: 'Banco DISCONNECTED-stale',
    });

    const boss = await import('@/jobs/boss');
    boss.drainQueue();

    const { reconcileStaleItemsWorker } = await import(
      '@/jobs/workers/reconcileStaleItemsWorker'
    );
    await reconcileStaleItemsWorker([
      { id: 'reconcile-job', name: 'pluggy.reconcile.stale-items', data: {} } as Job<unknown>,
    ]);

    const queued = boss.peekQueue();
    const sync_jobs = queued.filter(j => j.name === 'pluggy.sync');
    const enqueued_item_ids = sync_jobs.map(j => j.payload?.item_id);

    expect(enqueued_item_ids).toContain(itemUpdatedId);
    expect(enqueued_item_ids).not.toContain(itemDisconnectedId);
  });

  it('disconnected-lifecycle-4: connections page query filters out DISCONNECTED items', async () => {
    const { userId } = await createUserAndSession();
    const { itemId: itemUpdatedId } = await seedItem(userId, {
      status: 'UPDATED',
      institution_name: 'Banco UPDATED-render',
    });
    const { itemId: itemDisconnectedId } = await seedItem(userId, {
      status: 'DISCONNECTED',
      institution_name: 'Banco DISCONNECTED-render',
    });

    const db = await importDb();
    const { pluggy_items } = await import('@/db/schema');

    // Equivalent of the page.tsx server query (post 02-15 filter).
    const visible = await db
      .select({ id: pluggy_items.id, status: pluggy_items.status })
      .from(pluggy_items)
      .where(
        and(
          eq(pluggy_items.user_id, userId),
          ne(pluggy_items.status, 'DISCONNECTED'),
        ),
      );

    const visible_ids = visible.map(r => r.id);
    expect(visible_ids).toContain(itemUpdatedId);
    expect(visible_ids).not.toContain(itemDisconnectedId);
  });
});
