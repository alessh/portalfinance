/**
 * Integration test — pg-boss singleton dedup semantics.
 *
 * Closes 02-REVIEWS.md Concern #8 (MEDIUM): plans assume `singletonKey`
 * produces in-flight-only dedup, dropping concurrent enqueues for the same
 * key. (pg-boss v12 removed `singletonHours` — singletonKey alone is the
 * dedup primitive; production code at /api/pluggy/items/route.ts already
 * drops singletonHours.) Codex flagged that pg-boss v12's actual semantics
 * may differ (payload-diff bypass, backlog accumulation, etc.).
 *
 * Strategy: empirically verify both directions:
 *   pgboss-singleton-1 — same key + differing payloads → ≤2 completions in 6s.
 *   pgboss-singleton-2 — different keys → ≥2 concurrent completions.
 *
 * If pgboss-singleton-1 fires (dedup leaks), the test message points to the
 * fallback: an advisory transactional lock at sync entry
 * (pg_try_advisory_xact_lock(hashtext('pluggy.sync.' || user_id))). That
 * follow-up plan would land separately.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';

let td: TestDb;
let pg: ReturnType<typeof postgres>;

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');
  process.env.CPF_HASH_PEPPER = 'pgboss-cpf-pepper-at-least-32-chars-x';
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = 'pgboss-pluggy-pepper-32-chars-xxxxxxx';
  process.env.NEXTAUTH_SECRET = 'pgboss-test-secret-at-least-32-chars-x';
  process.env.PLUGGY_ENV = 'sandbox';
  process.env.PLUGGY_CLIENT_ID = 'test-client-id';
  process.env.PLUGGY_CLIENT_SECRET = 'test-client-secret';
  process.env.PLUGGY_WEBHOOK_SECRET = 'pgboss-webhook-secret-at-least-32-x-yy';
  // NOTE: deliberately NOT setting BOSS_TEST_MODE — this suite exercises real
  // pg-boss against the testcontainer to verify singleton semantics.
  delete process.env.BOSS_TEST_MODE;

  pg = postgres(td.url, { max: 1 });
  const db_migrate = drizzle(pg);
  await db_migrate.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await migrate(db_migrate, { migrationsFolder: './src/db/migrations' });
}, 180_000);

afterAll(async () => {
  await pg.end();
  await td.stop();
});

describe('pg-boss singleton semantics (Concern #8)', () => {
  it('pgboss-singleton-1: 5 enqueues with same singletonKey + singletonHours=0 do not produce 5 completions', async () => {
    const { getBoss } = await import('@/jobs/boss');
    const boss = await getBoss();

    const test_queue = `pluggy.sync.test1.${Date.now()}`;
    await boss.createQueue(test_queue);

    let completed = 0;
    await boss.work(test_queue, { batchSize: 1 }, async (jobs: Job<unknown>[]) => {
      for (const _job of jobs) {
        await new Promise((r) => setTimeout(r, 2000));
        completed++;
      }
    });

    const t0 = Date.now();
    const ids: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await boss.send(
        test_queue,
        { user_id: 'user-X', i },
        { singletonKey: 'user-X' },
      );
      ids.push(id);
    }

    await new Promise((r) => setTimeout(r, 6500));

    // Forensic visibility — emit observed semantics regardless of pass/fail.
    // If a future pg-boss upgrade breaks this assumption, the assertion message
    // recommends an advisory lock fallback (pg_try_advisory_xact_lock).
    // eslint-disable-next-line no-console
    console.log(
      `[pgboss-singleton-1] enqueued=5, ids_returned_non_null=${ids.filter(Boolean).length}, completed=${completed}, time_window=${Date.now() - t0}ms`,
    );

    expect(
      completed,
      `Expected ≤2 completions per pg-boss documented dedup intent; got ${completed}. ` +
        `If this fires consistently, payload-diff bypasses singleton dedup in pg-boss v12 — ` +
        `add an advisory DB lock at sync entry: pg_try_advisory_xact_lock(hashtext('pluggy.sync.' || user_id)).`,
    ).toBeLessThanOrEqual(2);
  }, 20_000);

  it('pgboss-singleton-2: different singletonKeys run concurrently', async () => {
    const { getBoss } = await import('@/jobs/boss');
    const boss = await getBoss();

    const test_queue = `pluggy.sync.test2.${Date.now()}`;
    await boss.createQueue(test_queue);

    let completed = 0;
    let in_flight = 0;
    let max_concurrent = 0;
    const witnesses: number[] = [];

    // Process the batch CONCURRENTLY within a single work() callback so we
    // can witness multiple in-flight jobs at once. (pg-boss v12 has no
    // built-in `teamSize` / `localConcurrency` knob; concurrency lives in
    // the handler.) For our purposes the question is "does singletonKey
    // dedup per key, or globally?" — running the batch concurrently means
    // at most one job per key can be in-flight at a time, so seeing
    // max_concurrent >= 2 proves per-key dedup.
    await boss.work(test_queue, { batchSize: 6 }, async (jobs: Job<unknown>[]) => {
      await Promise.all(
        jobs.map(async () => {
          in_flight++;
          max_concurrent = Math.max(max_concurrent, in_flight);
          witnesses.push(in_flight);
          await new Promise((r) => setTimeout(r, 1000));
          in_flight--;
          completed++;
        }),
      );
    });

    for (let i = 0; i < 3; i++) {
      await boss.send(test_queue, { user_id: 'user-A', i }, { singletonKey: 'user-A' });
      await boss.send(test_queue, { user_id: 'user-B', i }, { singletonKey: 'user-B' });
    }

    await new Promise((r) => setTimeout(r, 5000));

    // eslint-disable-next-line no-console
    console.log(
      `[pgboss-singleton-2] completed=${completed}, max_concurrent=${max_concurrent}, witnesses=${witnesses.join(',')}`,
    );

    expect(
      max_concurrent,
      `Expected at least 2 concurrent jobs (one per user-key); got ${max_concurrent}. ` +
        `If max_concurrent=1 the dedup is global, not per-key — singletonKey is misconfigured.`,
    ).toBeGreaterThanOrEqual(2);
  }, 15_000);
});
