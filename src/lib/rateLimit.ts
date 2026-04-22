/**
 * Postgres-backed sliding-window rate limiter (D-05).
 *
 * RESEARCH.md § Plan slice 01-02 item 6.
 *
 * One row per `(identifier, bucket, window_start)`. The UNIQUE index on
 * `auth_rate_limits` makes `INSERT ... ON CONFLICT DO UPDATE SET count
 * = count + 1` atomic. The query that decides allow/deny sums counts
 * across the last `window_ms` regardless of which fixed window each row
 * belongs to — so a user spreading attempts across the boundary still
 * gets caught.
 *
 * A pg-boss cron sweeper (added in plan 01-03) deletes rows older than
 * `now() - interval '1 hour'`. Until then, the table grows but queries
 * stay fast because every read is keyed on the unique index.
 */
import { sql, and, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { auth_rate_limits } from '@/db/schema';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

export type RateLimitBucket = 'LOGIN' | 'PASSWORD_RESET' | 'PASSWORD_RESET_IP';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

function floor_window(date: Date, window_ms: number): Date {
  return new Date(Math.floor(date.getTime() / window_ms) * window_ms);
}

/**
 * Atomically increment the counter for `(identifier, bucket)` in the
 * current window, then return the total count across the trailing
 * `window_ms` and whether it is within `limit`.
 */
export async function checkAndIncrement(
  identifier: string,
  bucket: RateLimitBucket,
  limit: number,
  window_ms: number = DEFAULT_WINDOW_MS,
): Promise<RateLimitResult> {
  const now = new Date();
  const window_start = floor_window(now, window_ms);
  const earliest = new Date(now.getTime() - window_ms);

  await db
    .insert(auth_rate_limits)
    .values({ identifier, bucket, window_start, count: 1 })
    .onConflictDoUpdate({
      target: [
        auth_rate_limits.identifier,
        auth_rate_limits.bucket,
        auth_rate_limits.window_start,
      ],
      set: { count: sql`${auth_rate_limits.count} + 1` },
    });

  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${auth_rate_limits.count})::int, 0)`,
    })
    .from(auth_rate_limits)
    .where(
      and(
        eq(auth_rate_limits.identifier, identifier),
        eq(auth_rate_limits.bucket, bucket),
        gte(auth_rate_limits.window_start, earliest),
      ),
    );

  const count = Number(row?.total ?? 0);
  return { allowed: count <= limit, count, limit };
}

/**
 * Reset all counters for `(identifier, bucket)`. Called after a
 * successful login so the next failure window starts at 1, not 6.
 */
export async function resetCounter(
  identifier: string,
  bucket: RateLimitBucket,
): Promise<void> {
  await db
    .delete(auth_rate_limits)
    .where(
      and(
        eq(auth_rate_limits.identifier, identifier),
        eq(auth_rate_limits.bucket, bucket),
      ),
    );
}
