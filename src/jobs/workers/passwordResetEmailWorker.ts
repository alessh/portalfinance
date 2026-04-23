/**
 * Password Reset Email Worker — Plan 01-03.
 *
 * Processes `email.password_reset` jobs. Renders the PasswordReset
 * React Email template and sends via SES mailer.
 */
import type { Job } from 'pg-boss';
import { sendEmail } from '@/lib/mailer';
import { PasswordReset } from '@/emails/PasswordReset';
import { logger } from '@/lib/logger';
import React from 'react';

export interface PasswordResetEmailPayload {
  to: string;
  reset_link: string;
  expires_at: string; // ISO string (Date serialized by pg-boss JSON)
}

export async function passwordResetEmailWorker(
  jobs: Job<PasswordResetEmailPayload>[],
): Promise<void> {
  for (const job of jobs) {
    try {
      await sendEmail({
        to: job.data.to,
        subject: 'Redefinição de senha — Portal Finance',
        template: React.createElement(PasswordReset, {
          reset_link: job.data.reset_link,
          expires_at: new Date(job.data.expires_at),
        }),
      });
    } catch (err) {
      logger.error(
        { event: 'worker_job_failed', job_id: job.id, worker: 'passwordResetEmail', error: String(err) },
        'Job processing failed — pg-boss will retry',
      );
      throw err;
    }
  }
}
