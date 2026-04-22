/**
 * Integration test — SES bounce SNS webhook + sesBounceWorker.
 *
 * Plan 01-04 — T-WH-REPLAY + T-WH-FORGE mitigations (D-15).
 * RESEARCH.md § Plan slice 01-04 item 7.
 *
 * Four scenarios covered:
 *   1. Invalid SNS signature → 401 (T-WH-FORGE)
 *   2. 3x replay of same MessageId → 1 webhook_events row + 1 ses_suppressions row (T-WH-REPLAY)
 *   3. SubscriptionConfirmation → fetches SubscribeURL (MSW intercept)
 *   4. Mailer refuses to send to suppressed email after bounce is processed
 *
 * Test strategy:
 *   - Direct-import webhook handler (no HTTP server needed).
 *   - sesBounceWorker called directly (not via pg-boss scheduler).
 *   - MSW intercepts the SubscribeURL fetch in scenario 3.
 *   - aws-sdk-client-mock intercepts SES in scenario 4.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql, eq, count } from 'drizzle-orm';
import postgres from 'postgres';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Job } from 'pg-boss';
import { startTestDb, type TestDb } from '../../fixtures/db';
import { createSesMock } from '../../fixtures/mailer';
import {
  makeSesBounceEnvelope,
  makeSnsSubscriptionConfirmation,
} from '../../fixtures/sns-fixtures';

// ---------------------------------------------------------------------------
// DB + module setup
// ---------------------------------------------------------------------------

let td: TestDb;
const ses_mock = createSesMock();

// Track whether the SubscribeURL was fetched
let subscribe_url_fetched = false;
const SUBSCRIBE_URL = 'https://sns.sa-east-1.amazonaws.com/subscribe?token=stub-token';

// MSW server — intercepts SubscribeURL confirmation
const server = setupServer(
  http.get(SUBSCRIBE_URL, () => {
    subscribe_url_fetched = true;
    return HttpResponse.text('SubscriptionConfirmed');
  }),
);

beforeAll(async () => {
  td = await startTestDb();

  process.env.DATABASE_URL = td.url;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.CPF_HASH_PEPPER = 'ses-test-pepper-at-least-32-chars-xxxx';
  process.env.NEXTAUTH_SECRET = 'ses-test-secret-at-least-32-chars-xxxxx';
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key-id';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-access-key';
  process.env.AWS_REGION = 'sa-east-1';
  process.env.SES_FROM_EMAIL = 'no-reply@portalfinance.com.br';

  // Apply migrations to the test database
  const client = postgres(td.url, { max: 1 });
  const db = drizzle(client);
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  } finally {
    await client.end();
  }

  server.listen({ onUnhandledRequest: 'warn' });
}, 180_000);

afterAll(async () => {
  server.close();
  ses_mock.reset();
  await td.stop();
});

beforeEach(() => {
  ses_mock.reset();
  subscribe_url_fetched = false;
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Helper: import fresh route handler (after vi.resetModules)
// ---------------------------------------------------------------------------

async function importRouteHandler() {
  const mod = await import('@/app/api/webhooks/ses/bounces/route');
  return mod.POST;
}

async function importWorker() {
  const mod = await import('@/jobs/workers/sesBounceWorker');
  return mod.sesBounceWorker;
}

async function importDb() {
  const { db } = await import('@/db');
  return db;
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/webhooks/ses/bounces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Scenario 1: Invalid signature → 401
// ---------------------------------------------------------------------------

describe('SES bounce webhook', () => {
  it('rejects invalid SNS signature with 401', async () => {
    // Do NOT mock verifySnsMessage — let sns-validator reject the stub signature.
    const handler = await importRouteHandler();
    const envelope = makeSesBounceEnvelope({
      messageId: 'msg-sig-test-001',
      bouncedEmail: 'bounce-sigtest@example.com',
    });

    const res = await handler(makeRequest(envelope));
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: 3x replay idempotency
  // ---------------------------------------------------------------------------

  it('3x replay of same MessageId produces 1 webhook_events row + 1 ses_suppressions row', async () => {
    // Mock verifySnsMessage → always passes
    vi.doMock('@/lib/snsVerifier', () => ({
      verifySnsMessage: vi.fn().mockResolvedValue(true),
    }));

    const handler = await importRouteHandler();
    const db = await importDb();
    const { webhook_events, ses_suppressions } = await import('@/db/schema');
    const sesBounceWorker = await importWorker();

    const message_id = `replay-test-${Date.now()}`;
    const bounced_email = `bounce-replay-${Date.now()}@example.com`;
    const envelope = makeSesBounceEnvelope({ messageId: message_id, bouncedEmail: bounced_email });

    // POST the same envelope three times
    await handler(makeRequest(envelope));
    await handler(makeRequest(envelope));
    await handler(makeRequest(envelope));

    // Assert exactly 1 webhook_events row exists
    const we_rows = await db
      .select({ cnt: count() })
      .from(webhook_events)
      .where(eq(webhook_events.event_id, message_id));
    expect(we_rows[0].cnt).toBe(1);

    // Get the webhook_event_id to pass to the worker
    const [we_row] = await db
      .select({ id: webhook_events.id })
      .from(webhook_events)
      .where(eq(webhook_events.event_id, message_id));

    // Run the worker directly (simulates pg-boss dispatching the job)
    const jobs: Job<{ webhook_event_id: string }>[] = [
      { data: { webhook_event_id: we_row.id } } as Job<{ webhook_event_id: string }>,
    ];
    await sesBounceWorker(jobs);
    // Run again (simulate double-delivery) — should be a no-op
    await sesBounceWorker(jobs);

    // Assert exactly 1 ses_suppressions row for the bounced email
    const ss_rows = await db
      .select({ cnt: count() })
      .from(ses_suppressions)
      .where(eq(ses_suppressions.email_lower, bounced_email.toLowerCase()));
    expect(ss_rows[0].cnt).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: SubscriptionConfirmation → fetch SubscribeURL
  // ---------------------------------------------------------------------------

  it('handles SubscriptionConfirmation by fetching SubscribeURL', async () => {
    vi.doMock('@/lib/snsVerifier', () => ({
      verifySnsMessage: vi.fn().mockResolvedValue(true),
    }));

    const handler = await importRouteHandler();
    const confirmation = makeSnsSubscriptionConfirmation({ subscribeUrl: SUBSCRIBE_URL });

    const res = await handler(makeRequest(confirmation));

    expect(res.status).toBe(200);
    expect(subscribe_url_fetched).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: mailer refuses to send to suppressed address
  // ---------------------------------------------------------------------------

  it('mailer refuses to send to a suppressed email after bounce is processed', async () => {
    vi.doMock('@/lib/snsVerifier', () => ({
      verifySnsMessage: vi.fn().mockResolvedValue(true),
    }));

    const handler = await importRouteHandler();
    const db = await importDb();
    const { webhook_events } = await import('@/db/schema');
    const sesBounceWorker = await importWorker();
    const { sendEmail } = await import('@/lib/mailer');

    const message_id = `suppression-guard-${Date.now()}`;
    const bounced_email = `block-me-${Date.now()}@example.com`;
    const envelope = makeSesBounceEnvelope({ messageId: message_id, bouncedEmail: bounced_email });

    // 1. Post the bounce notification
    const post_res = await handler(makeRequest(envelope));
    expect(post_res.status).toBe(200);

    // 2. Get the webhook_event_id
    const [we_row] = await db
      .select({ id: webhook_events.id })
      .from(webhook_events)
      .where(eq(webhook_events.event_id, message_id));
    expect(we_row).toBeDefined();

    // 3. Run sesBounceWorker — writes ses_suppressions row
    const jobs: Job<{ webhook_event_id: string }>[] = [
      { data: { webhook_event_id: we_row.id } } as Job<{ webhook_event_id: string }>,
    ];
    await sesBounceWorker(jobs);

    // 4. Try to send to the suppressed address
    // ses_mock is reset in beforeEach — no SES calls should happen
    // Use createElement to avoid JSX in a .ts file (no TSX extension).
    const { createElement } = await import('react');
    const result = await sendEmail({
      to: bounced_email,
      subject: 'Should not be sent',
      template: createElement('div', null, 'test'),
    });

    // The mailer suppression guard should block the send
    expect(result.suppressed).toBe(true);
    expect(result.messageId).toBeNull();
    // SES mock should have received ZERO SendEmailCommand calls
    expect(ses_mock.sent).toHaveLength(0);
  });
});
