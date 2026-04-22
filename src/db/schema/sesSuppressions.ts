import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * `ses_suppressions` — bounce/complaint blocklist (D-15).
 *
 * Populated by the SES-bounce webhook worker (plan 01-04). The mailer
 * helper consults this table before every send and refuses to dispatch
 * to a suppressed address.
 *
 * `notification_ids` collects every SES message id that produced a
 * bounce/complaint event for this address — useful for forensics.
 */
export const ses_suppressions = pgTable(
  'ses_suppressions',
  {
    email_lower: text('email_lower').primaryKey(),
    reason: text('reason').notNull(), // 'BOUNCE' | 'COMPLAINT'
    first_seen_at: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    notification_ids: text('notification_ids')
      .array()
      .notNull()
      .default([]),
  },
  (t) => ({
    email_lower_unique: uniqueIndex('ses_suppressions_email_lower_unique').on(
      t.email_lower,
    ),
  }),
);

export type SesSuppression = typeof ses_suppressions.$inferSelect;
export type NewSesSuppression = typeof ses_suppressions.$inferInsert;
