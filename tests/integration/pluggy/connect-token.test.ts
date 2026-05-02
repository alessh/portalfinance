/**
 * Integration test — POST /api/connect/init (connect-init-1..4).
 *
 * Plan 02-03 — Proves:
 *   - Invalid CPF → 400 INVALID_CPF, ZERO DB writes, ZERO PluggyService calls (D-06).
 *   - Valid CPF → 200 connect_token + 1 user_consents row PLUGGY_CONNECT_PENDING (D-08 step 1).
 *   - User already has CPF → 200 without updating users.cpf_enc.
 *   - No session → 401.
 *
 * Strategy:
 *   - Spin up testcontainers Postgres 16.
 *   - Apply Drizzle migrations.
 *   - Create user + session rows directly in DB.
 *   - Import route handler directly (no HTTP server).
 *   - Mock PluggyService.createConnectToken via vi.doMock.
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
// DB setup
// ---------------------------------------------------------------------------

let td: TestDb;
let pg: ReturnType<typeof postgres>;

const PLUGGY_CONNECT_TOKEN = 'tok-test-connect';
const SANDBOX_CPF = '761.092.776-73'; // Pluggy sandbox-safe valid CPF (docs/sandbox).
const INVALID_CPF = '111.111.111-11';

beforeAll(async () => {
  td = await startTestDb();

  // Set env BEFORE any module imports (vitest module registry caches env at import time).
  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
  process.env.CPF_HASH_PEPPER = 'ci-token-pepper-at-least-32-chars-xxxx';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'ci-item-id-pepper-at-least-32-chars-x';
  process.env.NEXTAUTH_SECRET = 'ci-token-secret-at-least-32-chars-xxxxx';
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
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Import the route after vi.resetModules + vi.doMock have been applied. */
async function importRouteHandler() {
  const mod = await import('@/app/api/connect/init/route');
  return mod.POST;
}

async function importDb() {
  const { db } = await import('@/db');
  return db;
}

/**
 * Create a test user and session. Returns { userId, sessionToken }.
 * cpf_enc length: 44 = signup placeholder (needs CPF); 39 = already set.
 */
async function createUserAndSession(opts?: { cpf_enc_len?: 44 | 39 }): Promise<{ userId: string; sessionToken: string }> {
  const db = await importDb();
  const { users, sessions } = await import('@/db/schema');

  // cpf_enc: 44 bytes = signup placeholder (needs CPF), 39 = real enc
  const cpf_enc_len = opts?.cpf_enc_len ?? 44;
  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `test-${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'argon2id-placeholder',
    cpf_hash: randomBytes(32),
    cpf_enc: randomBytes(cpf_enc_len),
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

function makeRequest(body: unknown, sessionToken?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sessionToken) {
    headers['cookie'] = `authjs.session-token=${sessionToken}`;
  }
  return new Request('http://localhost/api/connect/init', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/connect/init', () => {
  it('connect-init-1: invalid CPF → 400 INVALID_CPF, zero DB writes, zero PluggyService calls', async () => {
    // Mock PluggyService — the test asserts it is NEVER called.
    const mockCreateConnectToken = vi.fn().mockResolvedValue({ connect_token: PLUGGY_CONNECT_TOKEN });
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({ createConnectToken: mockCreateConnectToken }),
    }));

    const handler = await importRouteHandler();
    const db = await importDb();
    const { user_consents } = await import('@/db/schema');

    const { userId, sessionToken } = await createUserAndSession({ cpf_enc_len: 44 });

    // Count consents before the call.
    const before = await db.select({ n: count() }).from(user_consents).where(eq(user_consents.user_id, userId));
    const count_before = before[0].n;

    const res = await handler(makeRequest({ cpf: INVALID_CPF, granted: true }, sessionToken));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_CPF');

    // Assert: ZERO user_consents rows written.
    const after = await db.select({ n: count() }).from(user_consents).where(eq(user_consents.user_id, userId));
    expect(after[0].n).toBe(count_before);

    // Assert: PluggyService.createConnectToken NOT called.
    expect(mockCreateConnectToken).not.toHaveBeenCalled();
  });

  it('connect-init-2: valid CPF → 200 connect_token + 1 PLUGGY_CONNECT_PENDING consent row', async () => {
    const mockCreateConnectToken = vi.fn().mockResolvedValue({ connect_token: PLUGGY_CONNECT_TOKEN });
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({ createConnectToken: mockCreateConnectToken }),
    }));

    const handler = await importRouteHandler();
    const db = await importDb();
    const { user_consents } = await import('@/db/schema');

    const { userId, sessionToken } = await createUserAndSession({ cpf_enc_len: 44 });

    const res = await handler(makeRequest({ cpf: SANDBOX_CPF, granted: true }, sessionToken));
    expect(res.status).toBe(200);
    const body = await res.json() as { connect_token: string };
    expect(body.connect_token).toBe(PLUGGY_CONNECT_TOKEN);

    // Assert: exactly 1 PLUGGY_CONNECT_PENDING consent row for this user.
    const consents = await db
      .select({ scope: user_consents.scope, action: user_consents.action, consent_version: user_consents.consent_version })
      .from(user_consents)
      .where(eq(user_consents.user_id, userId));
    const pending = consents.filter(c => c.scope === 'PLUGGY_CONNECT_PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0].action).toBe('GRANTED');
    expect(pending[0].consent_version).toBeTruthy();

    // Assert: PluggyService.createConnectToken called exactly once.
    expect(mockCreateConnectToken).toHaveBeenCalledTimes(1);
  });

  it('connect-init-3: user already has CPF → 200 without re-encrypting cpf_enc', async () => {
    const mockCreateConnectToken = vi.fn().mockResolvedValue({ connect_token: PLUGGY_CONNECT_TOKEN });
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({ createConnectToken: mockCreateConnectToken }),
    }));

    const handler = await importRouteHandler();
    const db = await importDb();
    const { users } = await import('@/db/schema');

    // cpf_enc_len=39 simulates a user who already set a real CPF.
    const { userId, sessionToken } = await createUserAndSession({ cpf_enc_len: 39 });

    // Snapshot cpf_enc before the call.
    const [before] = await db.select({ cpf_enc: users.cpf_enc }).from(users).where(eq(users.id, userId));

    const res = await handler(makeRequest({ granted: true }, sessionToken));
    expect(res.status).toBe(200);
    const body = await res.json() as { connect_token: string };
    expect(body.connect_token).toBe(PLUGGY_CONNECT_TOKEN);

    // Assert: cpf_enc unchanged.
    const [after] = await db.select({ cpf_enc: users.cpf_enc }).from(users).where(eq(users.id, userId));
    expect(Buffer.from(after.cpf_enc as Buffer).toString('hex')).toBe(
      Buffer.from(before.cpf_enc as Buffer).toString('hex'),
    );
  });

  it('connect-init-4: no session → 401', async () => {
    vi.doMock('@/services/PluggyService', () => ({
      getPluggyService: () => ({ createConnectToken: vi.fn() }),
    }));

    const handler = await importRouteHandler();
    // No cookie header — session resolver returns null → UnauthorizedError.
    const res = await handler(makeRequest({ cpf: SANDBOX_CPF, granted: true }));
    expect(res.status).toBe(401);
  });
});
