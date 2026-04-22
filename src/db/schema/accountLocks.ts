import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `account_locks` — lockout + unlock-token state (AUTH-05 / D-06).
 *
 * Created when a user crosses the 5-failures-per-15-min threshold.
 * `unlock_token_hash` is argon2-hashed (NEVER plaintext); the unlock
 * email contains the plaintext token.
 *
 * Resolved by either:
 * - User clicks the unlock link before `unlock_token_expires_at`
 *   → `unlocked_at = now()`, `unlocked_via = 'EMAIL_LINK'`.
 * - Lock window expires naturally
 *   → `unlocked_at = now()`, `unlocked_via = 'TIMEOUT'`.
 */
export const account_locks = pgTable(
  'account_locks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    locked_at: timestamp('locked_at', { withTimezone: true }).notNull(),
    unlocks_at: timestamp('unlocks_at', { withTimezone: true }).notNull(),
    unlock_token_hash: text('unlock_token_hash').notNull(),
    unlock_token_expires_at: timestamp('unlock_token_expires_at', {
      withTimezone: true,
    }).notNull(),
    unlocked_at: timestamp('unlocked_at', { withTimezone: true }),
    // 'EMAIL_LINK' | 'TIMEOUT'
    unlocked_via: text('unlocked_via'),
  },
  (t) => ({
    by_user: index('account_locks_user_unlocks_idx').on(t.user_id, t.unlocks_at),
  }),
);

export type AccountLock = typeof account_locks.$inferSelect;
export type NewAccountLock = typeof account_locks.$inferInsert;
