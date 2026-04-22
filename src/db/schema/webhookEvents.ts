import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * `webhook_events` — idempotent webhook log.
 *
 * Pitfall P3 mitigation: every inbound webhook (SES bounce in Phase 1,
 * Pluggy in Phase 2, ASAAS in Phase 5) is gated by an `INSERT ... ON
 * CONFLICT DO NOTHING RETURNING id` on `(source, event_id)`. If the
 * RETURNING set is empty, the event has already been processed — return
 * 200 immediately and skip the worker enqueue.
 *
 * Receivers MUST return 200 in < 200 ms. All real work happens in the
 * pg-boss worker downstream.
 */
export const webhook_events = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(), // 'SES' | 'PLUGGY' | 'ASAAS'
    event_type: text('event_type').notNull(),
    event_id: text('event_id').notNull(),
    payload: jsonb('payload').notNull(),
    processed_at: timestamp('processed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    source_event_unique: uniqueIndex('webhook_events_source_event_unique').on(
      t.source,
      t.event_id,
    ),
  }),
);

export type WebhookEvent = typeof webhook_events.$inferSelect;
export type NewWebhookEvent = typeof webhook_events.$inferInsert;
