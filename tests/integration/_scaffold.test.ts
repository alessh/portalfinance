import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from '../fixtures/db';

let db: TestDb;

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

describe('testcontainers scaffold', () => {
  it('boots a Postgres container', () => {
    expect(db.url).toMatch(/^postgres:\/\//);
  });
});
