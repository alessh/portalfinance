import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea, item_status_enum } from './_shared';
import { users } from './users';

/**
 * `pluggy_items` — one row per Pluggy item (bank connection) per user.
 *
 * Design notes (D-43):
 * - `pluggy_item_id_enc` bytea NOT NULL — AES-256-GCM encrypted Pluggy item ID.
 *   Decrypted only inside PluggyService. NEVER stored, logged, or returned
 *   in plaintext (P4 / CONN-07).
 * - `pluggy_item_id_hash` bytea NOT NULL — SHA-256 digest used for UNIQUE
 *   lookup without decryption. Indexed via UNIQUE(user_id, pluggy_item_id_hash).
 * - `status` uses `item_status_enum` to model every Pluggy item state with
 *   actionable UI (P2): UPDATING, LOGIN_ERROR, OUTDATED, WAITING_USER_INPUT, UPDATED.
 * - `last_reauth_email_at` — debounce anchor for re-auth email cadence (D-34).
 *   Prevents email storms from Pluggy's retry chains.
 * - ON DELETE CASCADE from `users` handles LGPD hard-delete (Phase 6).
 */
export const pluggy_items = pgTable(
  'pluggy_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pluggy_item_id_enc: bytea('pluggy_item_id_enc').notNull(),
    pluggy_item_id_hash: bytea('pluggy_item_id_hash').notNull(),
    connector_id: text('connector_id').notNull(),
    institution_name: text('institution_name').notNull(),
    institution_logo_url: text('institution_logo_url'),
    status: item_status_enum('status').notNull(),
    execution_status: text('execution_status'),
    last_synced_at: timestamp('last_synced_at', { withTimezone: true }),
    last_error_at: timestamp('last_error_at', { withTimezone: true }),
    last_reauth_email_at: timestamp('last_reauth_email_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    user_item_unique: uniqueIndex('pluggy_items_user_item_hash_unique').on(
      t.user_id,
      t.pluggy_item_id_hash,
    ),
    by_user_status: index('pluggy_items_user_status_idx').on(t.user_id, t.status),
  }),
);

export type PluggyItem = typeof pluggy_items.$inferSelect;
export type NewPluggyItem = typeof pluggy_items.$inferInsert;
