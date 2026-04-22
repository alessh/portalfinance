import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `dsr_requests` — LGPD Data Subject Request stub (D-17 / Pitfall P15).
 *
 * Phase 1 ships the table + route stubs (`/api/privacy/export`,
 * `/api/privacy/delete`) that create a row with `status='PENDING'` and
 * enqueue a pg-boss job. Full export / delete execution is Phase 6.
 *
 * 15-day statutory response SLA — the Phase 6 worker will alert on
 * `status IN ('PENDING','IN_PROGRESS') AND requested_at < now() - interval
 * '14 days'` (one day of buffer).
 */
export const dsr_requests = pgTable(
  'dsr_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // 'EXPORT' | 'DELETE' | 'CORRECTION'
    request_type: text('request_type').notNull(),
    // 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
    status: text('status').notNull().default('PENDING'),
    requested_at: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolved_at: timestamp('resolved_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
  },
  (t) => ({
    by_user: index('dsr_requests_user_requested_idx').on(t.user_id, t.requested_at),
    by_status: index('dsr_requests_status_requested_idx').on(t.status, t.requested_at),
  }),
);

export type DsrRequest = typeof dsr_requests.$inferSelect;
export type NewDsrRequest = typeof dsr_requests.$inferInsert;
