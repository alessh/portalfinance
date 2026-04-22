import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Phase 1 audit action catalogue (D-19).
 *
 * Enforced as a TS union — NOT a DB CHECK constraint. The catalogue
 * expands in later phases (Pluggy connect events, billing events, admin
 * actions, DSR transitions); a CHECK constraint would force a migration
 * each time. App-layer enforcement via this type is the chosen trade-off.
 */
export type AuthAuditAction =
  | 'signup'
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'account_locked'
  | 'account_unlocked'
  | 'consent_granted'
  | 'consent_revoked';

/**
 * `audit_log` — append-only event trail.
 *
 * `metadata` is JSONB and MUST be PII-scrubbed before insert (see
 * `lib/piiScrubber.ts`, plan 01-03). Never write transaction descriptions,
 * raw CPFs, or PIX names here.
 */
export const audit_log = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULL for pre-auth events (e.g., failed login for unknown email).
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actor_type: text('actor_type').notNull(), // 'USER' | 'SYSTEM'
    actor_id: uuid('actor_id'),
    action: text('action').notNull(), // AuthAuditAction in Phase 1; expanded later
    entity_type: text('entity_type'),
    entity_id: uuid('entity_id'),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    by_user: index('audit_log_user_created_idx').on(t.user_id, t.created_at),
    by_action: index('audit_log_action_created_idx').on(t.action, t.created_at),
  }),
);

export type AuditLogEntry = typeof audit_log.$inferSelect;
export type NewAuditLogEntry = typeof audit_log.$inferInsert;
