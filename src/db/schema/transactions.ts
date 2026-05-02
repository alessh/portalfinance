import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tx_status_enum, tx_type_enum } from './_shared';
import { accounts } from './accounts';
import { users } from './users';

/**
 * `transactions` — raw transaction ledger from Pluggy.
 *
 * Design notes (D-45):
 * - `pluggy_transaction_id` text UNIQUE — enforces TX-01 dedup. Upsert key for
 *   ON CONFLICT DO UPDATE on every sync pass. DO NOT update `is_transfer`,
 *   `is_credit_card_payment`, or `transfer_pair_id` on upsert (set by detectors).
 * - `user_id` duplicated for IDOR guard (P26). Every query MUST include
 *   `AND user_id = $session`.
 * - `category_id` is a nullable text slug in Phase 2 (D-46). Phase 3 migrates
 *   this to a UUID FK once the `categories` table exists.
 * - `transfer_pair_id` self-FK uses lazy callback `(): AnyPgColumn => transactions.id`
 *   to avoid a circular reference at module load time (Pitfall 7).
 * - `raw_payload` jsonb NOT NULL — stores the complete Pluggy response for
 *   auditability. NOT encrypted (D-40 — only pluggy_item_id is encrypted at rest).
 *
 * Indexes:
 * - `transactions_pluggy_tx_unique` — dedup key (TX-01).
 * - `transactions_user_posted_idx` — hot path for /transactions list.
 * - `transactions_account_posted_idx` — per-account drill-down.
 * - `transactions_user_posted_real_idx` — partial index excluding transfers and
 *   fatura payments; used by Phase 4 aggregation pre-compute (DASH-01).
 */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }), // duplicated for IDOR (P26)
    account_id: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    pluggy_transaction_id: text('pluggy_transaction_id').notNull(),
    type: tx_type_enum('type').notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    description: text('description').notNull(),
    description_raw: text('description_raw'),
    merchant_name: text('merchant_name'),
    merchant_cnpj: text('merchant_cnpj'),
    posted_at: timestamp('posted_at', { withTimezone: true }).notNull(),
    status: tx_status_enum('status').notNull(),
    category_id: text('category_id'), // nullable text slug; Phase 3 migrates to UUID FK (D-46)
    is_transfer: boolean('is_transfer').notNull().default(false),
    is_credit_card_payment: boolean('is_credit_card_payment').notNull().default(false),
    transfer_pair_id: uuid('transfer_pair_id').references(
      (): AnyPgColumn => transactions.id, // lazy self-FK (Pitfall 7)
    ),
    pluggy_category: text('pluggy_category'),
    payment_method: text('payment_method'),
    raw_payload: jsonb('raw_payload').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pluggy_tx_unique: uniqueIndex('transactions_pluggy_tx_unique').on(t.pluggy_transaction_id),
    by_user_posted: index('transactions_user_posted_idx').on(t.user_id, t.posted_at.desc()),
    by_account_posted: index('transactions_account_posted_idx').on(
      t.account_id,
      t.posted_at.desc(),
    ),
    // Partial index — Phase 4 aggregation hot path (DASH-01). Excludes transfers
    // and credit-card fatura payments from monthly summaries.
    by_user_posted_real: index('transactions_user_posted_real_idx')
      .on(t.user_id, t.posted_at.desc())
      .where(sql`${t.is_transfer} = false AND ${t.is_credit_card_payment} = false`),
  }),
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
