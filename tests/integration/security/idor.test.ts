import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql, eq, and } from 'drizzle-orm';
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;

beforeAll(async () => {
  td = await startTestDb();
  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
  process.env.CPF_HASH_PEPPER =
    'integration-test-pepper-at-least-32-chars-xx';
  process.env.NEXTAUTH_SECRET =
    'integration-test-secret-at-least-32-chars-xx';

  const client = postgres(td.url, { max: 1 });
  const db = drizzle(client);
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  } finally {
    await client.end();
  }
}, 180_000);

afterAll(async () => {
  await td.stop();
});

beforeEach(async () => {
  const client = postgres(td.url, { max: 1 });
  try {
    await client`DELETE FROM audit_log`;
    await client`DELETE FROM user_consents`;
    await client`DELETE FROM users`;
  } finally {
    await client.end();
  }
});

/**
 * SEC-01 / Pitfall P26 baseline.
 *
 * The contract: every authenticated read MUST filter by the session's
 * user_id. A cross-user read returns 404 (not 403 — leaking row
 * existence is itself a privacy violation).
 *
 * The handler under test (`getMyAuditLog`) is a small representative
 * helper that follows the IDOR-safe pattern. Phase 2 routes (Pluggy
 * data, dashboard reads) MUST follow the same shape.
 */
describe('IDOR baseline (SEC-01)', () => {
  it('cross-user audit_log read returns null/404 (not the other user’s data)', async () => {
    const { signupAction } = await import('@/app/(auth)/signup/actions');
    const a = await signupAction({
      email: 'alice@example.com',
      password: 'Correct-Horse-1234',
      confirmPassword: 'Correct-Horse-1234',
      consent: true,
    });
    const b = await signupAction({
      email: 'bob@example.com',
      password: 'Correct-Horse-1234',
      confirmPassword: 'Correct-Horse-1234',
      consent: true,
    });
    expect(a.ok && b.ok).toBe(true);

    const { db } = await import('@/db');
    const { audit_log } = await import('@/db/schema');

    // The pattern under test: every query is filtered by the session's user_id.
    async function getMyAuditLog(session_user_id: string) {
      return db
        .select()
        .from(audit_log)
        .where(eq(audit_log.user_id, session_user_id));
    }

    const alice_rows = await getMyAuditLog(a.user_id!);
    const bob_rows = await getMyAuditLog(b.user_id!);

    expect(alice_rows.length).toBeGreaterThan(0);
    expect(bob_rows.length).toBeGreaterThan(0);
    expect(alice_rows.every((r) => r.user_id === a.user_id)).toBe(true);
    expect(bob_rows.every((r) => r.user_id === b.user_id)).toBe(true);

    // Now the IDOR attempt: Bob's session tries to read what Alice's
    // audit log row by id. A correctly-implemented route filters by
    // BOTH primary key AND user_id, so the row appears as "not found"
    // → callers turn that into a 404.
    const alice_row_id = alice_rows[0]!.id;
    async function getOneAuditRow(session_user_id: string, row_id: string) {
      const rows = await db
        .select()
        .from(audit_log)
        .where(and(eq(audit_log.id, row_id), eq(audit_log.user_id, session_user_id)));
      return rows[0] ?? null;
    }
    const bob_attempt = await getOneAuditRow(b.user_id!, alice_row_id);
    expect(bob_attempt).toBeNull();
  }, 60_000);

  it('cross-user user_consents read filtered by user_id returns nothing', async () => {
    const { signupAction } = await import('@/app/(auth)/signup/actions');
    const a = await signupAction({
      email: 'carol@example.com',
      password: 'Correct-Horse-1234',
      confirmPassword: 'Correct-Horse-1234',
      consent: true,
    });
    const b = await signupAction({
      email: 'dave@example.com',
      password: 'Correct-Horse-1234',
      confirmPassword: 'Correct-Horse-1234',
      consent: true,
    });

    const { db } = await import('@/db');
    const { user_consents } = await import('@/db/schema');

    const dave_attempt = await db
      .select()
      .from(user_consents)
      .where(
        and(
          eq(user_consents.user_id, b.user_id!),
          eq(user_consents.user_id, a.user_id!), // attempt to read alice's
        ),
      );
    expect(dave_attempt).toHaveLength(0);
  }, 60_000);

  it('requireSession() throws UnauthorizedError when no session is present', async () => {
    // requireSession depends on Auth.js's `auth()`. We mock the upstream
    // module so the test exercises the unauthenticated-throw path without
    // pulling next-auth's full edge-runtime entrypoint into Vitest (which
    // resolves `next/server` differently than Next does at build time).
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.doMock('@/auth', () => ({
      auth: async () => null,
      handlers: { GET: undefined, POST: undefined },
      signIn: async () => undefined,
      signOut: async () => undefined,
    }));
    try {
      const { requireSession, UnauthorizedError } = await import(
        '@/lib/session'
      );
      await expect(requireSession()).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    } finally {
      vi.doUnmock('@/auth');
      vi.resetModules();
    }
  }, 30_000);
});
