import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bytea } from './_shared';

/**
 * `users` — primary identity table.
 *
 * Phase 1 invariants (do NOT change in later phases without an explicit
 * migration plan):
 * - `id uuid PK` defaulting to `gen_random_uuid()` (requires pgcrypto).
 * - `email text UNIQUE NOT NULL` — lowercased at write time.
 * - `password_hash text NOT NULL` — argon2id, parameters per OWASP.
 * - `cpf_hash bytea NULL` — HMAC-SHA-256 with server-side pepper. Becomes
 *   NOT NULL via Phase 2 migration (per D-04). Partial unique index
 *   accepts multiple NULLs in Phase 1.
 * - `cpf_enc bytea NULL` — AES-256-GCM (iv || tag || ciphertext). Becomes
 *   NOT NULL via Phase 2 migration.
 * - `subscription_tier text NOT NULL DEFAULT 'paid'` — Phase 5 flips the
 *   default to 'free'. Existing rows stay 'paid' until explicitly migrated.
 * - `deleted_at` is the soft-delete marker; LGPD hard-delete worker (Phase
 *   6) acts on rows where `deleted_at < now() - interval '30 days'`.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    email_verified_at: timestamp('email_verified_at', { withTimezone: true }),
    password_hash: text('password_hash').notNull(),
    cpf_hash: bytea('cpf_hash'),
    cpf_enc: bytea('cpf_enc'),
    subscription_tier: text('subscription_tier').notNull().default('paid'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    email_unique: uniqueIndex('users_email_unique').on(t.email),
    cpf_hash_unique: uniqueIndex('users_cpf_hash_unique')
      .on(t.cpf_hash)
      .where(sql`${t.cpf_hash} IS NOT NULL`),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
