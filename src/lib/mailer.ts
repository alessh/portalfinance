/**
 * AWS SES v3 mailer wrapper — Plan 01-03.
 *
 * Enforces the ses_suppressions guard before every send. Populates the
 * suppression list from SES bounce/complaint webhooks (Plan 01-04).
 *
 * CRITICAL: This module must NEVER render or pass raw PII (CPF, email body
 * with user details, PIX descriptions) in the email body. Email templates
 * must accept only opaque IDs (protocol_id, request_type) — never raw user
 * fields. Enforced by template interface design in Plan 01-03.
 *
 * Phase 1 note: AWS credentials are optional (SES production access is a
 * Wave 4 task per D-12). When `AWS_ACCESS_KEY_ID` is absent, `sendEmail()`
 * logs a warning and returns `{ messageId: null, suppressed: false }`.
 * Phase 6 tightens this to throw in production.
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { render } from '@react-email/render';
import { db } from '@/db';
import { ses_suppressions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/env';
import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// SES client (lazy — only instantiated when first email is sent)
// ---------------------------------------------------------------------------

let _ses: SESClient | null = null;

function getSesClient(): SESClient {
  if (_ses) return _ses;
  // Read credentials from process.env directly so integration tests that set
  // AWS_ACCESS_KEY_ID in beforeAll() (after env.ts is first parsed) work
  // correctly without needing to restart the module registry.
  const access_key = process.env.AWS_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
  const secret_key = process.env.AWS_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;
  _ses = new SESClient({
    region: process.env.AWS_REGION ?? env.AWS_REGION,
    credentials:
      access_key && secret_key
        ? {
            accessKeyId: access_key,
            secretAccessKey: secret_key,
          }
        : undefined,
  });
  return _ses;
}

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

export interface SendEmailParams {
  to: string;
  subject: string;
  template: ReactElement;
}

export interface SendEmailResult {
  messageId: string | null;
  suppressed: boolean;
}

/**
 * Send an email via SES, after checking ses_suppressions.
 *
 * Returns `{ suppressed: true }` without calling SES if the recipient is
 * on the suppression list (T-SES-SUPPRESSION-BYPASS mitigation).
 *
 * Returns `{ messageId: null, suppressed: false }` if AWS credentials are
 * absent (Phase 1 development mode — SES access not yet provisioned).
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const to_lower = params.to.toLowerCase();

  // --- Suppression guard (MUST happen BEFORE SendEmailCommand) ---
  const [suppressed_row] = await db
    .select()
    .from(ses_suppressions)
    .where(eq(ses_suppressions.email_lower, to_lower));

  if (suppressed_row) {
    return { messageId: null, suppressed: true };
  }

  // --- Guard: abort if credentials missing (Phase 1 dev mode) ---
  // Read directly from process.env so integration tests that set env vars
  // in beforeAll() (after the `env` module is first parsed) are not blocked.
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn(
      '[mailer] AWS credentials not set — email would be sent to:',
      to_lower,
      '| Subject:',
      params.subject,
    );
    return { messageId: null, suppressed: false };
  }

  // --- Render template to HTML ---
  const html = await render(params.template);

  // --- Send via SES ---
  const cmd = new SendEmailCommand({
    Source: env.SES_FROM_EMAIL,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: params.subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  });

  const res = await getSesClient().send(cmd);
  return { messageId: res.MessageId ?? null, suppressed: false };
}
