import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { account_status_enum, account_type_enum } from './_shared';
import { pluggy_items } from './pluggyItems';
import { users } from './users';

/**
 * `accounts` — one row per sub-account within a Pluggy item.
 *
 * Design notes (D-44):
 * - `user_id` duplicated from `pluggy_items.user_id` for IDOR guard (P26).
 *   Every query MUST include `AND user_id = $session`.
 * - `pluggy_account_id` text UNIQUE — Pluggy's stable external identifier.
 *   Upsert key: ON CONFLICT (pluggy_account_id) DO UPDATE (TX-01 dedup pattern).
 * - `account_status_enum` includes FROZEN (shipped Phase 2 to support Phase 5
 *   BILL-04 downgrade-as-freeze without a future migration — D-44 decision).
 * - `balance` and `credit_limit` use numeric(15,2) to avoid floating-point
 *   inaccuracies on Brazilian BRL amounts.
 * - ON DELETE CASCADE from both `users` and `pluggy_items`.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }), // duplicated for IDOR (P26)
    pluggy_item_id: uuid('pluggy_item_id')
      .notNull()
      .references(() => pluggy_items.id, { onDelete: 'cascade' }),
    pluggy_account_id: text('pluggy_account_id').notNull(),
    type: account_type_enum('type').notNull(),
    subtype: text('subtype'),
    name: text('name').notNull(),
    currency: text('currency').notNull(),
    balance: numeric('balance', { precision: 15, scale: 2 }).notNull(),
    credit_limit: numeric('credit_limit', { precision: 15, scale: 2 }),
    status: account_status_enum('status').notNull().default('ACTIVE'),
    owner: text('owner'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pluggy_account_unique: uniqueIndex('accounts_pluggy_account_id_unique').on(
      t.pluggy_account_id,
    ),
    by_user_status: index('accounts_user_status_idx').on(t.user_id, t.status),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
