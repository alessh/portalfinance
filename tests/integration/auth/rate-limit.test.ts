import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;

beforeAll(async () => {
  td = await startTestDb();
  // Point the app at the testcontainers Postgres BEFORE any module that
  // touches `@/db` is imported (db/index.ts reads DATABASE_URL at load).
  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
  process.env.CPF_HASH_PEPPER =
    'integration-test-pepper-at-least-32-chars-xx';
  process.env.NEXTAUTH_SECRET =
    'integration-test-secret-at-least-32-chars-xx';

  // Run migrations.
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
  // Wipe rate-limit + lock state between tests so counters do not bleed.
  const client = postgres(td.url, { max: 1 });
  try {
    await client`DELETE FROM auth_rate_limits`;
    await client`DELETE FROM account_locks`;
    await client`DELETE FROM password_reset_tokens`;
    await client`DELETE FROM audit_log`;
    await client`DELETE FROM user_consents`;
    await client`DELETE FROM users`;
  } finally {
    await client.end();
  }
});

async function createTestUser(email: string, password: string): Promise<string> {
  const { signupAction } = await import('@/app/(auth)/signup/actions');
  const result = await signupAction({
    email,
    password,
    confirmPassword: password,
    consent: true,
  });
  if (!result.ok || !result.user_id) {
    throw new Error(`Signup failed: ${result.error}`);
  }
  return result.user_id;
}

function makeLoginRequest(
  email: string,
  password: string,
  ip = '198.51.100.42',
): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'user-agent': 'vitest',
    },
    body: JSON.stringify({ email, password }),
  });
}

function makeResetRequest(email: string, ip = '198.51.100.42'): Request {
  return new Request('http://localhost/api/auth/reset/request', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'user-agent': 'vitest',
    },
    body: JSON.stringify({ email }),
  });
}

describe('rate limiter — login (D-05 / D-06)', () => {
  it('returns 401 for the first 5 failures and 429 on the 6th + creates account_lock', async () => {
    const email = 'lockout@example.com';
    const password = 'Correct-Horse-1234';
    const user_id = await createTestUser(email, password);

    const { POST: loginPOST } = await import('@/app/api/auth/login/route');

    for (let i = 1; i <= 5; i++) {
      const res = await loginPOST(makeLoginRequest(email, 'wrong-password') as never);
      expect(res.status).toBe(401);
    }

    const sixth = await loginPOST(makeLoginRequest(email, 'wrong-password') as never);
    expect(sixth.status).toBe(429);

    const client = postgres(td.url, { max: 1 });
    try {
      const locks = await client<
        { id: string; user_id: string }[]
      >`SELECT id, user_id FROM account_locks WHERE user_id = ${user_id}`;
      expect(locks).toHaveLength(1);
    } finally {
      await client.end();
    }

    // The lockout email must be enqueued.
    const { drainQueue } = await import('@/jobs/boss');
    const jobs = drainQueue();
    expect(jobs.some((j) => j.name === 'send-account-unlock-email')).toBe(
      true,
    );
  }, 60_000);

  it('successful login resets the failure counter', async () => {
    const email = 'reset-counter@example.com';
    const password = 'Correct-Horse-1234';
    await createTestUser(email, password);
    const { POST: loginPOST } = await import('@/app/api/auth/login/route');

    // 3 failures
    for (let i = 0; i < 3; i++) {
      // Bypass turnstile: re-import after attempt 2 — but easier: stub by
      // calling with a synthetic turnstile token, since verifyTurnstile
      // returns true in the test env when no secret key is configured
      // (NODE_ENV=test fall-through). The route ALWAYS calls verify when
      // counter.count > 2; we satisfy it with any non-empty token.
      const res = await loginPOST(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            password: 'wrong',
            turnstileToken: 'test-token',
          }),
        }) as never,
      );
      expect(res.status).toBe(401);
    }

    // Successful login resets the counter.
    const ok = await loginPOST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          turnstileToken: 'test-token',
        }),
      }) as never,
    );
    expect(ok.status).toBe(200);

    // After reset, 5 more failures should produce 401, 401, 401, 401, 401, then 429 on the 6th.
    for (let i = 0; i < 5; i++) {
      const res = await loginPOST(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            password: 'wrong',
            turnstileToken: 'test-token',
          }),
        }) as never,
      );
      expect(res.status).toBe(401);
    }
    const sixth = await loginPOST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'wrong',
          turnstileToken: 'test-token',
        }),
      }) as never,
    );
    expect(sixth.status).toBe(429);
  }, 60_000);
});

describe('rate limiter — password reset (D-08)', () => {
  it('3 password-reset requests per email per hour return 200; 4th returns 429', async () => {
    const email = 'reset-cap-email@example.com';
    await createTestUser(email, 'Correct-Horse-1234');
    const { POST: resetPOST } = await import(
      '@/app/api/auth/reset/request/route'
    );

    for (let i = 1; i <= 3; i++) {
      const res = await resetPOST(makeResetRequest(email, `198.51.100.${i}`) as never);
      expect(res.status).toBe(200);
    }
    const fourth = await resetPOST(
      makeResetRequest(email, '198.51.100.99') as never,
    );
    expect(fourth.status).toBe(429);
  }, 60_000);

  it('10 reset requests from the same IP per hour return 200; 11th returns 429', async () => {
    const ip = '198.51.100.50';
    // Create 11 distinct test users so the per-email cap is not the gate.
    const emails: string[] = [];
    for (let i = 0; i < 11; i++) {
      const email = `reset-ip-${i}@example.com`;
      await createTestUser(email, 'Correct-Horse-1234');
      emails.push(email);
    }
    const { POST: resetPOST } = await import(
      '@/app/api/auth/reset/request/route'
    );
    for (let i = 0; i < 10; i++) {
      const res = await resetPOST(makeResetRequest(emails[i], ip) as never);
      expect(res.status).toBe(200);
    }
    const eleventh = await resetPOST(
      makeResetRequest(emails[10], ip) as never,
    );
    expect(eleventh.status).toBe(429);
  }, 60_000);

  it('returns identical 200 body for known and unknown emails (anti-enumeration)', async () => {
    const known = 'known-anti-enum@example.com';
    await createTestUser(known, 'Correct-Horse-1234');
    const { POST: resetPOST } = await import(
      '@/app/api/auth/reset/request/route'
    );

    const known_res = await resetPOST(
      makeResetRequest(known, '198.51.100.10') as never,
    );
    const unknown_res = await resetPOST(
      makeResetRequest('does-not-exist@example.com', '198.51.100.11') as never,
    );

    expect(known_res.status).toBe(200);
    expect(unknown_res.status).toBe(200);
    expect(await known_res.json()).toEqual(await unknown_res.json());
  }, 60_000);
});
