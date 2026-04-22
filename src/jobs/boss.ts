/**
 * Job-queue facade used by Phase 1 auth flows.
 *
 * Plan 01-03 replaces this with the full pg-boss singleton. For Phase
 * 1 we provide a minimal in-memory queue with the same `enqueue(name,
 * payload)` signature so the integration tests can assert "job was
 * enqueued" without needing pg-boss running.
 *
 * Production / Railway deployment in Phase 6 will use the real pg-boss
 * client; the API surface stays identical.
 */

export interface EnqueuedJob {
  name: string;
  payload: Record<string, unknown>;
  enqueued_at: Date;
}

const queue: EnqueuedJob[] = [];

export async function enqueue(
  name: string,
  payload: Record<string, unknown>,
): Promise<void> {
  queue.push({ name, payload, enqueued_at: new Date() });
}

/** Test-only — drain the in-memory queue. */
export function drainQueue(): EnqueuedJob[] {
  return queue.splice(0, queue.length);
}

/** Test-only — peek at the queue without draining. */
export function peekQueue(): readonly EnqueuedJob[] {
  return queue.slice();
}
