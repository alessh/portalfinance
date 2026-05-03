/**
 * Vitest globalSetup for the integration project (plan 02-09).
 *
 * Lifecycle:
 *   1. setup()   runs ONCE before any integration test file.
 *      It triggers the singleton in tests/fixtures/db.ts so the Postgres
 *      testcontainer is ready by the time the first suite's `beforeAll`
 *      calls `startTestDb()` (which then returns the cached promise
 *      synchronously-ish — same Promise, no extra Docker call).
 *   2. teardown() runs ONCE after every integration test file completes.
 *      It stops the shared container and clears the singleton.
 *
 * Pinned together with `pool: 'forks'` + `singleFork: true` +
 * `fileParallelism: false` in `vitest.config.ts`. With these flags, the
 * module instance from step 1 is re-used across every suite (single
 * process), so the cached container survives the entire run.
 *
 * Without these flags, vitest's default file parallelism would launch
 * multiple worker processes; each would re-execute this setup() once,
 * which would defeat the point. The single-fork pin is therefore part
 * of the contract — see vitest.config.ts.
 */
import { startTestDb, stopSharedTestDb, type TestDb } from './db';

let booted: TestDb | null = null;

export async function setup(): Promise<void> {
  // Boot the shared container exactly once. Any error here surfaces as a
  // globalSetup failure with full stderr — clearer than a per-suite
  // "Hook timed out" cascade.
  booted = await startTestDb();
  // Expose the URL for any consumer that prefers reading from env over
  // calling startTestDb() directly. Existing suites continue to call
  // startTestDb() (cached singleton) so they pick up the same URL.
  process.env.TEST_DATABASE_URL = booted.url;
}

export async function teardown(): Promise<void> {
  await stopSharedTestDb();
  booted = null;
  delete process.env.TEST_DATABASE_URL;
}

// Vitest 3.0.5 quirk: if a globalSetup file has a `default` export, vitest
// REQUIRES it to be a function (single-function form: setup() returns
// teardown). It REJECTS a default-exported `{ setup, teardown }` object with
// "invalid export in globalSetup file: default must be a function". The
// supported shape is ONLY named `setup` + `teardown` exports — see
// node_modules/vitest/dist/chunks/cli-api.az_rB_xZ.js loadGlobalSetupFile.
// We therefore omit the default export entirely.
