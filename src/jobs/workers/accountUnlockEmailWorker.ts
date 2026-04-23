/**
 * Account Unlock Email Worker — Plan 01-03.
 *
 * Processes `email.account_unlock` jobs. Renders the AccountUnlock
 * React Email template and sends via SES mailer.
 */
import type { Job } from 'pg-boss';
import { sendEmail } from '@/lib/mailer';
import { AccountUnlock } from '@/emails/AccountUnlock';
import { logger } from '@/lib/logger';
import React from 'react';

export interface AccountUnlockEmailPayload {
  to: string;
  unlock_link: string;
  expires_at: string; // ISO string (Date serialized by pg-boss JSON)
}

export async function accountUnlockEmailWorker(
  jobs: Job<AccountUnlockEmailPayload>[],
): Promise<void> {
  for (const job of jobs) {
    try {
      await sendEmail({
        to: job.data.to,
        subject: 'Desbloqueie sua conta — Portal Finance',
        template: React.createElement(AccountUnlock, {
          unlock_link: job.data.unlock_link,
          expires_at: new Date(job.data.expires_at),
        }),
      });
    } catch (err) {
      logger.error(
        { event: 'worker_job_failed', job_id: job.id, worker: 'accountUnlockEmail', error: String(err) },
        'Job processing failed — pg-boss will retry',
      );
      throw err;
    }
  }
}
