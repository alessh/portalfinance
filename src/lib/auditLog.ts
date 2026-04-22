/**
 * Append-only audit log writer.
 *
 * Phase 1 only emits the auth-event catalogue (D-19) declared as the
 * `AuthAuditAction` union in `src/db/schema/auditLog.ts`. Later phases
 * extend the catalogue.
 *
 * **PII contract (plan 01-03):** All metadata passes through
 * `piiScrubber.scrubObject()` before INSERT so `audit_log.metadata`
 * never contains raw CPFs / emails / PIX descriptions.
 * Failed-login records MUST use `{ email_attempted_scrubbed: '[EMAIL]' }`
 * (NOT the raw email) — D-19 / RESEARCH.md § Plan slice 01-03 item 5.
 */
import { db } from '@/db';
import { audit_log, type AuthAuditAction } from '@/db/schema';
import { scrubObject } from '@/lib/piiScrubber';

export interface RecordAuditParams {
  user_id?: string | null;
  action: AuthAuditAction;
  actor_type?: 'USER' | 'SYSTEM';
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(params: RecordAuditParams): Promise<void> {
  await db.insert(audit_log).values({
    user_id: params.user_id ?? null,
    actor_type: params.actor_type ?? 'USER',
    action: params.action,
    ip_address: params.ip_address ?? null,
    user_agent: params.user_agent ?? null,
    metadata: params.metadata ? (scrubObject(params.metadata) as never) : null,
  });
}
