import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export interface SentEmail {
  to: string;
  subject: string;
  html: string;
}

export function createSesMock() {
  const ses = mockClient(SESClient);
  const sent: SentEmail[] = [];

  function registerHandler() {
    ses.on(SendEmailCommand).callsFake((input) => {
      sent.push({
        to: input.Destination?.ToAddresses?.[0] ?? '',
        subject: input.Message?.Subject?.Data ?? '',
        html: input.Message?.Body?.Html?.Data ?? '',
      });
      return {
        MessageId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    });
  }

  // Register handler on creation
  registerHandler();

  return {
    ses,
    sent,
    reset: () => {
      sent.length = 0;
      ses.reset();
      // Re-register handler after reset (ses.reset() clears all handlers)
      registerHandler();
    },
  };
}
