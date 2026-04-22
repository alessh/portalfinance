import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `sessions` — Auth.js v5 database-strategy sessions.
 *
 * Database-backed sessions are required for AUTH-03 (server-side logout
 * everywhere) — JWT sessions cannot be revoked without a blocklist.
 *
 * Cascade on user delete so the LGPD account-deletion flow (Phase 6)
 * sweeps active sessions automatically.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    session_token: text('session_token').notNull().unique(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    by_user: index('sessions_user_id_idx').on(t.user_id),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
