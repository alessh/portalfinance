import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `subscriptions` — Phase-1 placeholder so Phase 5 doesn't need a `users`
 * table migration. One row per user (UNIQUE constraint). `status='NONE'`
 * default means "no subscription yet" — Phase 5 transitions to ACTIVE /
 * PAST_DUE / CANCELED on ASAAS webhook events.
 */
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider'),
  provider_subscription_id: text('provider_subscription_id'),
  plan_id: text('plan_id'),
  // 'NONE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'
  status: text('status').notNull().default('NONE'),
  current_period_end: timestamp('current_period_end', { withTimezone: true }),
  cancel_at_period_end: boolean('cancel_at_period_end').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
