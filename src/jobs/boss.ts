/**
 * pg-boss singleton — job queue client for Portal Finance.
 *
 * Plan 01-03 replaces the Phase 1 STUB (in-memory queue) with the real
 * pg-boss singleton. The `enqueue()` signature is kept backward-compatible
 * so existing callers (login route, reset route) continue to work without
 * modification.
 *
 * Architecture notes:
 *   - The web service ONLY calls `enqueue()` — it creates a pg-boss client
 *     connection for INSERTs into `pgboss.job` and never calls `start()`.
 *   - The worker service (src/jobs/worker.ts) calls `getBoss()` which starts
 *     pg-boss and begins draining queues. Only ONE process may call `start()`.
 *   - pg-boss creates its own schema (`pgboss.*`) separate from `public.*`.
 *
 * **Test mode:** When `BOSS_TEST_MODE=1` or `NODE_ENV=test`, enqueue() uses
 * an in-memory fallback queue and does NOT attempt a real pg-boss connection.
 * This preserves the testability of routes that call enqueue() without
 * requiring pg-boss schema initialization in testcontainers.
 * Call `drainQueue()` / `peekQueue()` in tests to inspect enqueued jobs.
 *
 * See RESEARCH.md § Plan slice 01-03 item 3 — DSR stubs contract.
 */
import { PgBoss, type SendOptions } from 'pg-boss';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Queue name constants — single source of truth for all consumers
// ---------------------------------------------------------------------------

export const QUEUES = {
  DSR_ACKNOWLEDGE: 'dsr.acknowledge',
  SEND_PASSWORD_RESET_EMAIL: 'email.password_reset',
  SEND_UNLOCK_EMAIL: 'email.account_unlock',
  SES_BOUNCE: 'ses.bounce', // wired in 01-04
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ---------------------------------------------------------------------------
// In-memory test queue (used when NODE_ENV=test or BOSS_TEST_MODE=1)
// ---------------------------------------------------------------------------

export interface EnqueuedJob {
  name: string;
  payload: Record<string, unknown>;
  enqueued_at: Date;
}

const _test_queue: EnqueuedJob[] = [];

function isTestMode(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.BOSS_TEST_MODE === '1'
  );
}

// ---------------------------------------------------------------------------
// Real pg-boss singleton (production / worker service)
// ---------------------------------------------------------------------------

let _boss: PgBoss | null = null;

/**
 * Return (or create) the pg-boss singleton.
 *
 * Called by the WORKER service only. Web API routes use `enqueue()` directly,
 * which also calls this — pg-boss will start a lightweight client connection
 * without draining queues when `start()` hasn't been called yet.
 */
export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;
  _boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss',
  });
  _boss.on('error', (err: Error) => {
    // Log but do not throw — pg-boss errors are often transient network issues.
    // The worker's main() will exit(1) on fatal errors.
    console.error('[pg-boss] error', err);
  });
  await _boss.start();
  // pg-boss v10+ no longer auto-creates queues on first work()/send(). Both
  // the web service (enqueue) and the worker service (work) call getBoss(),
  // so registering every known queue here is idempotent and unblocks both
  // sides regardless of cold-start order. createQueue is a no-op if the
  // queue already exists.
  for (const queue of Object.values(QUEUES)) {
    await _boss.createQueue(queue);
  }
  return _boss;
}

// ---------------------------------------------------------------------------
// enqueue — primary public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a job into a named pg-boss queue.
 *
 * In test mode (NODE_ENV=test or BOSS_TEST_MODE=1), pushes to the in-memory
 * test queue instead of pg-boss, so integration tests don't need a running
 * pg-boss schema. Call `drainQueue()` / `peekQueue()` to inspect.
 *
 * Returns the pg-boss job ID (a UUID) or `null` if deduplication
 * suppressed the insert (e.g., singletonKey match).
 *
 * This signature is stable across Phase 1–6 — downstream callers
 * import `enqueue` from here and never from the boss instance directly.
 */
export async function enqueue<T = unknown>(
  queue_name: string,
  data: T,
  options?: SendOptions,
): Promise<string | null> {
  if (isTestMode()) {
    _test_queue.push({
      name: queue_name,
      payload: data as Record<string, unknown>,
      enqueued_at: new Date(),
    });
    return `test-job-${Date.now()}`;
  }
  const boss = await getBoss();
  return boss.send(queue_name, data as object, options ?? {});
}

// ---------------------------------------------------------------------------
// Legacy helpers — kept for backward compatibility with 01-02 callers.
// ---------------------------------------------------------------------------

/** @deprecated Use enqueue(QUEUES.SEND_UNLOCK_EMAIL, payload) */
export async function enqueueUnlockEmail(payload: Record<string, unknown>): Promise<void> {
  await enqueue(QUEUES.SEND_UNLOCK_EMAIL, payload);
}

/** @deprecated Use enqueue(QUEUES.SEND_PASSWORD_RESET_EMAIL, payload) */
export async function enqueuePasswordResetEmail(payload: Record<string, unknown>): Promise<void> {
  await enqueue(QUEUES.SEND_PASSWORD_RESET_EMAIL, payload);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Test-only — drain the in-memory test queue and return all jobs. */
export function drainQueue(): EnqueuedJob[] {
  return _test_queue.splice(0, _test_queue.length);
}

/** Test-only — peek at the in-memory test queue without consuming. */
export function peekQueue(): readonly EnqueuedJob[] {
  return _test_queue.slice();
}
