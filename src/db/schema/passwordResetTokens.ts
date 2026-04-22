import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `password_reset_tokens` — AUTH-04 reset-link state.
 *
 * `token_hash` stores an argon2 hash of a `crypto.randomBytes(32)` token.
 * The plaintext token only travels in the reset email.
 *
 * Lookup pattern: SELECT all unexpired+unused tokens for the user, then
 * `argon2.verify` each. At realistic volumes (≤1 active token per user)
 * timing-safety is not a concern.
 */
export const password_reset_tokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token_hash: text('token_hash').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    used_at: timestamp('used_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    by_user: index('password_reset_tokens_user_created_idx').on(
      t.user_id,
      t.created_at,
    ),
    token_hash_unique: uniqueIndex('password_reset_tokens_token_hash_unique').on(
      t.token_hash,
    ),
  }),
);

export type PasswordResetToken = typeof password_reset_tokens.$inferSelect;
export type NewPasswordResetToken = typeof password_reset_tokens.$inferInsert;
