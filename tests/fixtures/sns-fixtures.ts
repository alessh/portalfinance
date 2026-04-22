/**
 * SNS message fixtures for integration tests.
 *
 * Plan 01-04 — ses-bounce.test.ts fixtures.
 *
 * These fixtures produce realistic-shaped SNS envelopes WITHOUT a real AWS
 * signature. In tests, `verifySnsMessage` is mocked to return `true` so we
 * can exercise the webhook handler logic without needing AWS credentials.
 *
 * The one exception is the "invalid signature" test case — that test does NOT
 * mock verifySnsMessage and relies on sns-validator rejecting the stub
 * Signature value, producing a 401 response.
 */

import type { SnsMessage } from '@/lib/snsVerifier';

/**
 * Build a realistic SES Bounce Notification SNS envelope.
 *
 * Signature is a stub (not cryptographically valid). In tests, mock
 * verifySnsMessage to bypass signature verification.
 */
export function makeSesBounceEnvelope(params: {
  messageId: string;
  bouncedEmail: string;
  bounceType?: string;
}): SnsMessage {
  return {
    Type: 'Notification',
    MessageId: params.messageId,
    TopicArn: 'arn:aws:sns:sa-east-1:000000000000:ses-bounces',
    Message: JSON.stringify({
      notificationType: 'Bounce',
      mail: { messageId: `mail-${params.messageId}` },
      bounce: {
        bouncedRecipients: [{ emailAddress: params.bouncedEmail }],
        bounceType: params.bounceType ?? 'Permanent',
      },
    }),
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1',
    Signature: 'STUB_SIGNATURE_NOT_VALID',
    SigningCertURL: 'https://sns.sa-east-1.amazonaws.com/cert.pem',
  };
}

/**
 * Build a realistic SNS SubscriptionConfirmation envelope.
 */
export function makeSnsSubscriptionConfirmation(params: {
  subscribeUrl: string;
}): SnsMessage {
  return {
    Type: 'SubscriptionConfirmation',
    MessageId: `sub-confirm-${Date.now()}`,
    TopicArn: 'arn:aws:sns:sa-east-1:000000000000:ses-bounces',
    Message: 'You have chosen to subscribe to the topic.',
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1',
    Signature: 'STUB_SIGNATURE_NOT_VALID',
    SigningCertURL: 'https://sns.sa-east-1.amazonaws.com/cert.pem',
    SubscribeURL: params.subscribeUrl,
    Token: 'stub-token',
  };
}
