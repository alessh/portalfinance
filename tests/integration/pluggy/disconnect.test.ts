/**
 * Integration test — DELETE /api/pluggy/items/:id (disconnect flow).
 *
 * Plan 02-06 Task 2 — Covers:
 *   - disconnect-1: happy path — Pluggy delete + accounts cascade + consent revocation + audit
 *   - disconnect-2: Pluggy API failure → 502 PLUGGY_API_ERROR, local state unchanged
 *   - disconnect-3: IDOR — user A session, user B's item → 404 (NOT 403, P26)
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16, apply Drizzle migrations.
 *   - Mock PluggyService.deleteItem via vi.doMock for happy/failure cases.
 *   - Import route handler dynamically after mocking.
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
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
  process.env.CPF_HASH_PEPPER = 'ci-disconnect-pepper-at-least-32-chars-xx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'ci-disconnect-pluggy-pepper-32-chars-xxxx';
  process.env.NEXTAUTH_SECRET = 'ci-disconnect-secret-at-least-32-chars-xxx';
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
    email: `disconnect-${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'argon2id-placeholder',
    cpf_hash: randomBytes(32),
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

async function createPluggyItemWithAccount(userId: string): Promise<{
  itemId: string;
  accountId: string;
  connectorId: string;
}> {
  const db = await importDb();
  const { pluggy_items, accounts } = await import('@/db/schema');
  const { encryptCPF, hashPluggyItemId } = await import('@/lib/crypto');

  const connectorId = 'itau-banking';
  const pluggy_item_id = `test-item-disconnect-${Date.now()}-${Math.random()}`;
  const enc = encryptCPF(pluggy_item_id);
  const hash = hashPluggyItemId(pluggy_item_id);

  const [item] = await db
    .insert(pluggy_items)
    .values({
      user_id: userId,
      pluggy_item_id_enc: enc,
      pluggy_item_id_hash: hash,
      connector_id: connectorId,
      institution_name: 'Itaú',
      status: 'UPDATED',
    })
    .returning({ id: pluggy_items.id });

  const [account] = await db
    .insert(accounts)
    .values({
      user_id: userId,
      pluggy_item_id: item.id,
      pluggy_account_id: `acc-${Date.now()}`,
      type: 'CHECKING',
      name: 'Conta Corrente',
      currency: 'BRL',
      balance: '1234.56',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });

  return { itemId: item.id, accountId: account.id, connectorId };
}

function makeDeleteRequest(itemId: string, sessionToken?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers['cookie'] = `authjs.session-token=${sessionToken}`;
  }
  return new Request(`http://localhost/api/pluggy/items/${itemId}`, {
    method: 'DELETE',
    headers,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DELETE /api/pluggy/items/:id', () => {
  it('disconnect-1: happy path — Pluggy delete + accounts cascade + consent revocation + audit', async () => {
    // Mock PluggyService.deleteItem to succeed
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({
        deleteItem: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    const { DELETE: handler } = await import('@/app/api/pluggy/items/[id]/route');
    const db = await importDb();
    const { accounts, user_consents, audit_log, pluggy_items } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const { userId, sessionToken } = await createUserAndSession();
    const { itemId, accountId, connectorId } = await createPluggyItemWithAccount(userId);

    const req = makeDeleteRequest(itemId, sessionToken);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    expect(res.status).toBe(200);
    const body = await res.json() as { disconnected: boolean };
    expect(body.disconnected).toBe(true);

    // Assert: account.status = 'DELETED'
    const [acc] = await db
      .select({ status: accounts.status })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(acc.status).toBe('DELETED');

    // Assert: user_consents row appended with action='REVOKED'
    const consents = await db
      .select({ action: user_consents.action, scope: user_consents.scope })
      .from(user_consents)
      .where(eq(user_consents.user_id, userId));
    const revoke = consents.find(
      (c) => c.action === 'REVOKED' && c.scope === `PLUGGY_CONNECTOR:${connectorId}`,
    );
    expect(revoke).toBeDefined();

    // Assert: audit_log row with action='item_disconnected'
    const audits = await db
      .select({ action: audit_log.action })
      .from(audit_log)
      .where(eq(audit_log.user_id, userId));
    const disconnectAudit = audits.find((a) => a.action === 'item_disconnected');
    expect(disconnectAudit).toBeDefined();

    // Assert: pluggy_items row still exists (history preserved per D-04)
    const [item] = await db
      .select({ id: pluggy_items.id })
      .from(pluggy_items)
      .where(eq(pluggy_items.id, itemId));
    expect(item).toBeDefined();

    void accountId;
  });

  it('disconnect-2: Pluggy API failure → 502 PLUGGY_API_ERROR, local state unchanged', async () => {
    // Mock PluggyService.deleteItem to reject
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({
        deleteItem: vi.fn().mockRejectedValue(new Error('Pluggy API 500')),
      }),
    }));

    const { DELETE: handler } = await import('@/app/api/pluggy/items/[id]/route');
    const db = await importDb();
    const { accounts } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const { userId, sessionToken } = await createUserAndSession();
    const { itemId, accountId } = await createPluggyItemWithAccount(userId);

    const req = makeDeleteRequest(itemId, sessionToken);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('PLUGGY_API_ERROR');

    // Assert: account.status still ACTIVE (no local mutation on Pluggy failure)
    const [acc] = await db
      .select({ status: accounts.status })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(acc.status).toBe('ACTIVE');
  });

  it('disconnect-3: IDOR — user A session, user B item → 404 (not 403, P26)', async () => {
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({
        deleteItem: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    const { DELETE: handler } = await import('@/app/api/pluggy/items/[id]/route');

    const { userId: userA_id, sessionToken: userA_token } = await createUserAndSession();
    const { userId: userB_id } = await createUserAndSession();

    // Create item owned by user B
    const { itemId } = await createPluggyItemWithAccount(userB_id);

    // User A tries to delete user B's item
    const req = makeDeleteRequest(itemId, userA_token);
    const res = await handler(req, { params: Promise.resolve({ id: itemId }) });

    expect(res.status).toBe(404);

    void userA_id;
  });
});
