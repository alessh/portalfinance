/**
 * Sentry beforeSend PII-scrubbing tests.
 *
 * Plan 01-04 — T-PII-LEAK mitigation coverage.
 * RESEARCH.md § Plan slice 01-04 item 3.
 *
 * 5 required cases (per plan acceptance_criteria):
 *   1. CPF stripped from message
 *   2. Email stripped from exception value
 *   3. Nested extras scrubbed (key-based + string-based)
 *   4. user.id hashed (16-char hex)
 *   5. No throw on malformed / null input
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';

// Set NEXTAUTH_SECRET so hashUserIdForSentry can generate a hash.
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-chars-long-xxx';
  // NODE_ENV is already 'test' in unit test context.
});

// Import after env is set.
const getSentryLib = () => import('@/lib/sentry');

describe('beforeSend — PII scrubbing', () => {
  it('strips CPF from event.message', async () => {
    const { beforeSend } = await getSentryLib();
    const event = {
      message: 'Failed for user 123.456.789-00',
    };
    const result = beforeSend(event as ErrorEvent);
    expect(result?.message).toBeDefined();
    expect(result?.message).not.toContain('123.456.789-00');
    expect(result?.message).toContain('[CPF]');
  });

  it('strips email from exception.values[0].value', async () => {
    const { beforeSend } = await getSentryLib();
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Auth error for user test@example.com',
          },
        ],
      },
    };
    const result = beforeSend(event as ErrorEvent);
    expect(result?.exception?.values?.[0].value).toBeDefined();
    expect(result?.exception?.values?.[0].value).not.toContain('test@example.com');
    expect(result?.exception?.values?.[0].value).toContain('[EMAIL]');
  });

  it('scrubs nested extras — key-based redaction + string scrub', async () => {
    const { beforeSend } = await getSentryLib();
    const event = {
      extra: {
        payload: {
          cpf: '12345678900',
          // Use 'note' (not in PII_KEYS) to exercise string-based scrubbing of CPF pattern.
          note: 'PIX 123.456.789-00',
        },
      } as Record<string, unknown>,
    };
    const result = beforeSend(event as ErrorEvent);
    const payload = (result?.extra as Record<string, Record<string, string>>)?.payload;
    expect(payload).toBeDefined();
    // Key-based: cpf key → '[REDACTED]'
    expect(payload.cpf).toBe('[REDACTED]');
    // String-based: note contains CPF pattern → '[CPF]'
    expect(payload.note).not.toContain('123.456.789-00');
    expect(payload.note).toContain('[CPF]');
  });

  it('hashes user.id to a 16-char hex string', async () => {
    const { beforeSend } = await getSentryLib();
    const event = {
      user: {
        id: 'some-uuid-v4-value',
        email: 'should-be-dropped@example.com',
      },
    };
    const result = beforeSend(event as ErrorEvent);
    expect(result?.user).toBeDefined();
    // user.id should be a 16-char hex string (not the original)
    const resultId = result?.user?.id;
    expect(resultId).toBeDefined();
    expect(resultId).not.toBe('some-uuid-v4-value');
    expect(typeof resultId).toBe('string');
    expect((resultId as string).length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(resultId as string)).toBe(true);
    // email should be dropped
    expect((result?.user as Record<string, unknown>)?.email).toBeUndefined();
  });

  it('does not throw when given a malformed or null event', async () => {
    const { beforeSend } = await getSentryLib();
    // Should not throw even for edge-case inputs.
    expect(() => beforeSend(null as unknown as ErrorEvent)).not.toThrow();
    expect(() => beforeSend({} as ErrorEvent)).not.toThrow();
    expect(() =>
      beforeSend({ extra: undefined, exception: undefined } as ErrorEvent),
    ).not.toThrow();
  });
});
