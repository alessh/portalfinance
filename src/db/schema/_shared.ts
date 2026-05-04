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

/**
 * Pluggy item sync status. Values 1-5 mirror Pluggy's item.status field
 * (https://docs.pluggy.ai/docs/item-lifecycle). 'DISCONNECTED' is internal —
 * set by our DELETE /api/pluggy/items/:id route to mark a user-initiated
 * disconnect; prevents stale webhooks or reconcile cron from re-syncing.
 *
 * State transitions (Pluggy-driven, plus the local DISCONNECTED transition):
 *   UPDATING → UPDATED            (sync success)
 *   UPDATING → LOGIN_ERROR        (credentials rejected)
 *   UPDATING → WAITING_USER_INPUT (MFA challenge)
 *   UPDATED  → OUTDATED           (refresh overdue per Pluggy heuristic)
 *   *        → DISCONNECTED       (DELETE /api/pluggy/items/:id — terminal)
 *
 * Use src/lib/pluggyItemStatus.ts helpers for syncability + re-auth gates;
 * NEVER do direct string comparisons in workers, routes, or UI.
 */
export const item_status_enum = pgEnum('item_status', [
  'UPDATING',
  'LOGIN_ERROR',
  'OUTDATED',
  'WAITING_USER_INPUT',
  'UPDATED',
  // Plan 02-15 / Concern #7 — terminal state for user-initiated disconnect.
  'DISCONNECTED',
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
