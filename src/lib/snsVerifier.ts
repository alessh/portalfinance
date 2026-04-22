/**
 * AWS SNS message signature verifier.
 *
 * Plan 01-04 — T-WH-FORGE mitigation.
 *
 * CRITICAL: Do NOT bypass or stub this in production. Skipping SNS signature
 * verification allows any HTTP client to poison the ses_suppressions table
 * by forging bounce notifications (RESEARCH.md Landmine — free suppression
 * poisoning attack).
 *
 * Uses the `sns-validator` package which:
 *   1. Downloads the SigningCertURL X.509 certificate (cached by URL).
 *   2. Reconstructs the signed string per the SNS specification.
 *   3. Verifies the RSA-SHA1 signature against the public key.
 *
 * In tests, mock this module:
 *   vi.mock('@/lib/snsVerifier', () => ({ verifySnsMessage: async () => true }))
 */
import MessageValidator from 'sns-validator';

const validator = new MessageValidator();

export interface SnsMessage {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string; // JSON-encoded string for SES Notification type
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string; // present only on SubscriptionConfirmation
  Token?: string;
  [key: string]: unknown;
}

/**
 * Verify an SNS message's X.509 signature.
 *
 * Returns `true` if the signature is valid, `false` otherwise.
 * Never throws — invalid signatures return false.
 *
 * Note: the first call per unique `SigningCertURL` makes an outbound HTTPS
 * request to download the certificate. Subsequent calls with the same URL
 * use the in-memory cache maintained by `sns-validator`.
 */
export async function verifySnsMessage(body: SnsMessage): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    validator.validate(body, (err) => resolve(!err));
  });
}
