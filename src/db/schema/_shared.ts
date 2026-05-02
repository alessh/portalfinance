import { customType, pgEnum } from 'drizzle-orm/pg-core';

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

// ---------------------------------------------------------------------------
// Phase 2 enum declarations (D-43/D-44/D-45)
// All pgEnum declarations live here to avoid collision across schema files.
// ---------------------------------------------------------------------------

/** Pluggy item sync status — maps 1:1 to Pluggy item.status field. */
export const item_status_enum = pgEnum('item_status', [
  'UPDATING',
  'LOGIN_ERROR',
  'OUTDATED',
  'WAITING_USER_INPUT',
  'UPDATED',
]);

/** Account type taxonomy — includes FROZEN (Phase 5 downgrade-as-freeze, D-44). */
export const account_type_enum = pgEnum('account_type', [
  'CHECKING',
  'SAVINGS',
  'CREDIT_CARD',
  'LOAN',
  'INVESTMENT',
  'OTHER',
]);

/** Account lifecycle status (D-44). */
export const account_status_enum = pgEnum('account_status', [
  'ACTIVE',
  'FROZEN',
  'DELETED',
]);

/** Transaction flow direction (D-45). */
export const tx_type_enum = pgEnum('tx_type', ['DEBIT', 'CREDIT']);

/** Transaction settlement status (D-45). Pending excluded from totals (Phase 4). */
export const tx_status_enum = pgEnum('tx_status', ['PENDING', 'POSTED']);
