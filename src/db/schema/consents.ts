/**
 * `user_consents` — LGPD per-source consent audit (Pitfall P11).
 *
 * APPEND-ONLY. App code MUST NEVER `UPDATE` or `DELETE` rows in this
 * table. Revocations are NEW rows with `action='REVOKED'`. The history
 * forms the audit trail required by LGPD Art. 7 and Art. 8.
 *
 * Phase 1 writes one row per signup with `scope='ACCOUNT_CREATION'`.
 * Phase 2 reuses the same table for `scope='PLUGGY_CONNECTOR:{id}'`
 * (per-data-source consent before each Pluggy Connect opens).
 */
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const user_consents = pgTable(
  'user_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // ON DELETE RESTRICT — consent history must outlive a soft-deleted
    // user; hard-delete worker (Phase 6) anonymizes consent rows in place.
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // 'ACCOUNT_CREATION' (Phase 1) | 'PLUGGY_CONNECTOR:{id}' (Phase 2) | ...
    scope: text('scope').notNull(),
    // 'GRANTED' | 'REVOKED'
    action: text('action').notNull(),
    // Semver / hash of the ToS + Privacy Policy text the user accepted.
    consent_version: text('consent_version').notNull(),
    // Stored as text for Phase 1 simplicity; cast-safe to inet later.
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    granted_at: timestamp('granted_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    by_user_scope: index('user_consents_user_scope_idx').on(
      t.user_id,
      t.scope,
      t.created_at,
    ),
  }),
);

export type UserConsent = typeof user_consents.$inferSelect;
export type NewUserConsent = typeof user_consents.$inferInsert;
