import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres `bytea` (binary blob) custom type for Drizzle.
 *
 * Used for AES-256-GCM encrypted columns (`cpf_enc`, `pluggy_item_id` in
 * Phase 2) and SHA-256 / HMAC-SHA-256 digest columns (`cpf_hash`).
 *
 * Drizzle has no first-class `bytea` helper — we declare one once here so
 * every schema file that needs binary storage imports the same instance.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});
