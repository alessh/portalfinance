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
 * Plan 01.1-03 / RESEARCH Recommendation 1 — credential strategy:
 *   - Production (Copilot Fargate): no AWS_ACCESS_KEY_* env vars; the SES
 *     SDK falls through its default credential provider chain to the IAM
 *     task role attached to the service. env.ts (per Plan 01.1-02 Task 2)
 *     marks both keys .optional(), so the OPS-04 boot guard does not fire.
 *     If the task role is missing or lacks ses:SendEmail, the SDK throws
 *     CredentialsProviderError on the first SendEmail call (fail-closed).
 *   - Local development / tests: set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
 *     to drive the AWS SDK mock. No code change required.
 *   - Local development without creds AND NODE_ENV !== 'production':
 *     `sendEmail()` short-circuits with a warning log and returns
 *     { messageId: null, suppressed: false } so dev flows are not blocked.
 */
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { render } from '@react-email/render';
import { db } from '@/db';
import { ses_suppressions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// SES client (lazy — only instantiated when first email is sent)
// ---------------------------------------------------------------------------

let _ses: SESClient | null = null;

function getSesClient(): SESClient {
  if (_ses) return _ses;
  // Plan 01.1-03 / RESEARCH Rec 1 -- prefer IAM task role in production
  // (Copilot manifest does NOT inject AWS_ACCESS_KEY_ID). Fall back to
  // explicit credentials when they are set locally for pnpm dev / tests.
  // env.ts already marks AWS_ACCESS_KEY_ID/SECRET as optional in prod
  // (Plan 01.1-02 Task 2) -- this is the consumer pivot.
  //
  // Read directly from process.env so integration tests that mutate the
  // environment in beforeAll() (after env.ts is first parsed) work without
  // resetting the module registry.
  const explicitCreds =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined;

  _ses = new SESClient({
    region: process.env.AWS_REGION ?? env.AWS_REGION,
    ...(explicitCreds ? { credentials: explicitCreds } : {}),
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

  // --- Guard: dev-mode skip when no AWS creds AND not production ---
  // In production the SES SDK uses the IAM task role (Plan 01.1-03 / Rec 1).
  // The early-return is reserved for local development without explicit creds.
  if (
    process.env.NODE_ENV !== 'production' &&
    (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)
  ) {
    // Use structured logger so this warning flows through the pino scrubObject
    // hook and is captured by Railway's JSON log aggregator. The recipient
    // address is intentionally redacted — raw PII must never appear in logs.
    logger.warn(
      { event: 'mailer_no_credentials', email_lower: '[EMAIL REDACTED IN DEV]' },
      '[mailer] AWS credentials not set — skipping send (dev mode only)',
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
