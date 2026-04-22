import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * `auth_rate_limits` — Postgres-backed sliding-window counter (D-05).
 *
 * One row per (identifier, bucket, 15-minute window_start). The UNIQUE
 * constraint lets us atomically `INSERT ... ON CONFLICT DO UPDATE SET
 * count = count + 1`.
 *
 * Buckets:
 * - 'LOGIN' — keyed on email (lowercased).
 * - 'PASSWORD_RESET' — keyed on email (lowercased).
 * - 'PASSWORD_RESET_IP' — keyed on hashed remote IP.
 *
 * A pg-boss cron sweeper (`sweep-rate-limits`, plan 01-02 wires it) deletes
 * rows where `window_start < now() - interval '1 hour'`.
 */
export const auth_rate_limits = pgTable(
  'auth_rate_limits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    bucket: text('bucket').notNull(),
    window_start: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    by_window: uniqueIndex('auth_rate_limits_identifier_bucket_window_unique').on(
      t.identifier,
      t.bucket,
      t.window_start,
    ),
  }),
);

export type AuthRateLimit = typeof auth_rate_limits.$inferSelect;
export type NewAuthRateLimit = typeof auth_rate_limits.$inferInsert;
