import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `admin_access_log` — SEC-03 / Pitfall P27 skeleton.
 *
 * Phase 1 ships the table only. Wiring (admin re-auth, append on every
 * support view, 2-year retention sweep) lands in Phase 6 admin tooling.
 *
 * No FK to `users` because admin and target may both be soft-deleted at
 * different times and the audit trail must outlive both.
 */
export const admin_access_log = pgTable(
  'admin_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    admin_user_id: uuid('admin_user_id').notNull(),
    target_user_id: uuid('target_user_id').notNull(),
    resource_type: text('resource_type'),
    resource_id: uuid('resource_id'),
    action: text('action').notNull(),
    ip_address: text('ip_address'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    by_admin: index('admin_access_log_admin_created_idx').on(
      t.admin_user_id,
      t.created_at,
    ),
  }),
);

export type AdminAccessLogEntry = typeof admin_access_log.$inferSelect;
export type NewAdminAccessLogEntry = typeof admin_access_log.$inferInsert;
