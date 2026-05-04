/**
 * Centralized item-state policy (closes 02-REVIEWS.md Concerns #6 + #7).
 *
 * Single source of truth for syncability and re-auth gating. Workers, routes,
 * UI components, and reconciliation cron all consume these helpers — direct
 * string comparisons against `item_status` values are forbidden in this
 * codebase (plan 02-15 acceptance criteria enforces a grep sweep over
 * src/jobs/, src/app/api/pluggy/, and src/app/settings/connections/).
 *
 * OUTDATED handling table (Concern #6 closure):
 *
 *   status='OUTDATED' + executionStatus=null OR healthy → syncable, no reauth.
 *   status='OUTDATED' + executionStatus='ERROR'         → syncable, ALSO
 *      surfaces the re-auth banner (the user knows something is wrong even
 *      though Pluggy can technically retry).
 *
 * DISCONNECTED is terminal (Concern #7 closure) — it never transitions back.
 * To reconnect, the user must create a new pluggy_items row via /connect (a
 * fresh consent + new Pluggy item). This preserves LGPD's append-only consent
 * semantics: a revoked consent cannot be silently re-granted by a stray
 * webhook or reconcile cron tick.
 */

export type PluggyItemStatus =
  | 'UPDATING'
  | 'LOGIN_ERROR'
  | 'OUTDATED'
  | 'WAITING_USER_INPUT'
  | 'UPDATED'
  | 'DISCONNECTED';

const SYNC_BLOCKED: ReadonlySet<PluggyItemStatus> = new Set<PluggyItemStatus>([
  'UPDATING',           // already in flight — pg-boss singleton dedup also covers this
  'LOGIN_ERROR',        // credentials rejected; need re-auth before sync
  'WAITING_USER_INPUT', // MFA challenge open; need re-auth before sync
  'DISCONNECTED',       // terminal user revocation; never sync
]);

const REAUTH_REQUIRED: ReadonlySet<PluggyItemStatus> = new Set<PluggyItemStatus>([
  'LOGIN_ERROR',
  'WAITING_USER_INPUT',
]);

/**
 * Returns true iff the item is in a state where a sync job should run.
 * UPDATING is excluded because a sync is already underway; DISCONNECTED is
 * excluded because the user revoked.
 */
export function isSyncableItemStatus(status: PluggyItemStatus): boolean {
  return !SYNC_BLOCKED.has(status);
}

/**
 * Returns true iff the user must complete re-auth before this item can resume
 * syncing. OUTDATED with an explicit error executionStatus also surfaces the
 * banner so users do not silently sit on a stale connection.
 */
export function needsReauth(
  status: PluggyItemStatus,
  execution_status?: string | null,
): boolean {
  if (REAUTH_REQUIRED.has(status)) return true;
  if (status === 'OUTDATED' && execution_status === 'ERROR') return true;
  return false;
}

/**
 * Returns the canonical reason string for log emission when sync is skipped.
 * Used by pluggySyncWorker so reasons stay consistent across the codebase.
 */
export function syncSkipReason(status: PluggyItemStatus): string {
  switch (status) {
    case 'UPDATING':
      return 'item_already_updating';
    case 'LOGIN_ERROR':
    case 'WAITING_USER_INPUT':
      return 'item_broken';
    case 'DISCONNECTED':
      return 'item_disconnected';
    case 'UPDATED':
    case 'OUTDATED':
      return 'item_status_unknown';
    default: {
      // Exhaustiveness guard — adding a new value to PluggyItemStatus that
      // forgets a case here will fail TypeScript compilation.
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
