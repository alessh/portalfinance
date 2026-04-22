/**
 * DSR Acknowledge Worker — Plan 01-03.
 *
 * Processes `dsr.acknowledge` jobs enqueued by /api/privacy/export and
 * /api/privacy/delete. Reads the dsr_requests row, renders the
 * DSRAcknowledgment React Email template, and sends via SES.
 *
 * Phase 1 scope: ACKNOWLEDGMENT ONLY. The worker does NOT execute the
 * actual export or deletion — that is Phase 6 (D-17). It only:
 *   1. Fetches the DSR record
 *   2. Sends the acknowledgment email with the protocol ID
 *   3. Records an audit log entry
 *
 * PII contract: Only `dsr_request_id` (opaque UUID) and the `user_email`
 * (passed as the `to:` destination, never in the HTML body) flow through
 * this worker. The DSRAcknowledgment template accepts only
 * `{ request_type, dsr_request_id }` — no CPF, no account data.
 */
import type { Job } from 'pg-boss';
import { db } from '@/db';
import { dsr_requests } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { sendEmail } from '@/lib/mailer';
import { DSRAcknowledgment } from '@/emails/DSRAcknowledgment';
import { recordAudit } from '@/lib/auditLog';
import React from 'react';

export interface DsrAcknowledgePayload {
  dsr_request_id: string;
  user_email: string;
}

export async function dsrAcknowledgeWorker(
  jobs: Job<DsrAcknowledgePayload>[],
): Promise<void> {
  for (const job of jobs) {
    const [req] = await db
      .select()
      .from(dsr_requests)
      .where(eq(dsr_requests.id, job.data.dsr_request_id));

    if (!req) {
      // Job payload references a non-existent row — skip silently.
      // This can happen if a delete rolled back after enqueue.
      console.warn('[dsrAcknowledgeWorker] DSR row not found:', job.data.dsr_request_id);
      continue;
    }

    const is_export = req.request_type === 'EXPORT';
    const subject = is_export
      ? 'Solicitação de exportação recebida — Portal Finance'
      : 'Solicitação de exclusão recebida — Portal Finance';

    await sendEmail({
      to: job.data.user_email,
      subject,
      template: React.createElement(DSRAcknowledgment, {
        request_type: req.request_type as 'EXPORT' | 'DELETE',
        dsr_request_id: req.id,
      }),
    });

    // Record acknowledgment in audit_log.
    // Action 'consent_granted' is reused for Phase 1 — Phase 6 adds
    // 'dsr_acknowledgment_sent' to the AuthAuditAction catalogue (D-19).
    await recordAudit({
      user_id: req.user_id,
      action: 'consent_granted',
      actor_type: 'SYSTEM',
      metadata: { protocol: req.id, acknowledgment: 'sent' },
    });
  }
}
