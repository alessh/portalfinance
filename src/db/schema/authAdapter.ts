import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Auth.js v5 Drizzle adapter tables — RENAMED from the adapter defaults to
 * avoid collisions with Phase 2's Pluggy schema.
 *
 * RESEARCH.md Pitfall 4 / D-?? — the `@auth/drizzle-adapter` default name
 * for OAuth provider rows is `account` (singular) / we expose it as
 * `accounts_oauth` here so Phase 2 can claim the bare `accounts` name for
 * Pluggy bank accounts without a rename migration.
 *
 * Wire-up in src/auth.ts (plan 01-02):
 *
 *   DrizzleAdapter(db, {
 *     usersTable: users,
 *     accountsTable: accounts_oauth,
 *     sessionsTable: sessions,
 *     verificationTokensTable: verification_tokens,
 *   });
 *
 * Phase 1 uses only the credentials provider; these tables are empty in
 * production until OAuth providers are added (deferred to v1.x).
 */
export const accounts_oauth = pgTable(
  'accounts_oauth',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

/**
 * `verification_tokens` — Auth.js adapter requirement for email-link /
 * magic-link flows. Phase 1 uses it for password-reset tokens.
 */
export const verification_tokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

export type OAuthAccount = typeof accounts_oauth.$inferSelect;
export type VerificationToken = typeof verification_tokens.$inferSelect;
