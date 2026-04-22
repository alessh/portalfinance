/**
 * Integration test — LGPD consent writes at signup.
 *
 * Plan 01-03 — Task 2.
 *
 * Verifies:
 * 1. Signup writes a user_consents row with scope='ACCOUNT_CREATION',
 *    action='GRANTED', IP + UA present, consent_version starts with v1.0.0+terms.
 * 2. audit_log contains a 'signup' action row for the same user with
 *    SCRUBBED metadata (no raw email in metadata).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;

beforeAll(async () => {
  td = await startTestDb();
  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64');
  process.env.CPF_HASH_PEPPER = 'consent-test-pepper-at-least-32-chars-xx';
  process.env.NEXTAUTH_SECRET = 'consent-test-secret-at-least-32-chars-xx';
  // Turnstile not needed for consent tests (signup doesn't require it)
  process.env.TURNSTILE_SECRET_KEY = undefined as never;

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
    await client`DELETE FROM sessions`;
    await client`DELETE FROM users`;
  } finally {
    await client.end();
  }
});

describe('LGPD consent at signup', () => {
  it('writes a user_consents row with correct fields', async () => {
    const { signup } = await import('@/app/(auth)/signup/actions');
    const result = await signup({
      email: 'consent-test@example.com',
      password: 'Password123strong',
      confirmPassword: 'Password123strong',
      consent: true,
      ip_address: '192.168.1.100',
      user_agent: 'Mozilla/5.0 (Test)',
    });
    expect(result.ok).toBe(true);
    expect(result.user_id).toBeDefined();

    const { user_consents } = await import('@/db/schema');
    const { db } = await import('@/db');

    const rows = await db
      .select()
      .from(user_consents)
      .where(eq(user_consents.user_id, result.user_id!));

    expect(rows).toHaveLength(1);
    const consent = rows[0];
    expect(consent?.scope).toBe('ACCOUNT_CREATION');
    expect(consent?.action).toBe('GRANTED');
    expect(consent?.ip_address).toBe('192.168.1.100');
    expect(consent?.user_agent).toBe('Mozilla/5.0 (Test)');
    expect(consent?.consent_version).toBeTruthy();
    expect(consent?.consent_version).toMatch(/^v1\.0\.0\+terms\./);
  });

  it('audit_log has a signup row with scrubbed metadata (no raw email)', async () => {
    const { signup } = await import('@/app/(auth)/signup/actions');
    const test_email = 'audit-scrub@example.com';
    const result = await signup({
      email: test_email,
      password: 'Password123strong',
      confirmPassword: 'Password123strong',
      consent: true,
      ip_address: '10.0.0.1',
      user_agent: 'Test-Agent/1.0',
    });
    expect(result.ok).toBe(true);

    const { audit_log } = await import('@/db/schema');
    const { db } = await import('@/db');

    const rows = await db
      .select()
      .from(audit_log)
      .where(eq(audit_log.user_id, result.user_id!));

    const signup_row = rows.find((r) => r.action === 'signup');
    expect(signup_row).toBeDefined();

    // metadata should not contain the raw email
    const metadata_str = JSON.stringify(signup_row?.metadata ?? {});
    expect(metadata_str).not.toContain(test_email);
  });
});
