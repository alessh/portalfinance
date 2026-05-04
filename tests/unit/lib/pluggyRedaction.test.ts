/**
 * Unit tests for redactPluggyPayload.
 *
 * Closes 02-REVIEWS.md Concern #1 (HIGH — plaintext pluggy_item_id leakage
 * into webhook_events.payload + pg-boss job payloads).
 *
 * Behavior contract:
 *   - redaction-1: top-level itemId replaced with itemIdHash hex; other fields preserved.
 *   - redaction-2: payload without itemId returns clone with no itemIdHash and no itemId key.
 *   - redaction-3: nested error.message verbatim (no Phase 2 deep scrub).
 *   - redaction-4: original input MUST NOT be mutated.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';

const ITEM_ID_HASH_PEPPER = 'redact-test-pepper-at-least-32-chars-x';

beforeAll(() => {
  process.env.PLUGGY_ITEM_ID_HASH_PEPPER = ITEM_ID_HASH_PEPPER;
  // crypto.ts also reads ENCRYPTION_KEY at module load via env.ts — set it.
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
  process.env.CPF_HASH_PEPPER = 'redact-cpf-pepper-at-least-32-chars-xxx';
  process.env.NEXTAUTH_SECRET = 'redact-test-secret-at-least-32-chars-xxx';
});

function expectedHashHex(plaintext: string): string {
  return createHmac('sha256', Buffer.from(ITEM_ID_HASH_PEPPER, 'utf8'))
    .update(plaintext)
    .digest('hex');
}

describe('redactPluggyPayload', () => {
  it('redaction-1: replaces top-level itemId with itemIdHash hex and preserves other fields', async () => {
    const { redactPluggyPayload } = await import('@/lib/pluggyRedaction');
    const out = redactPluggyPayload({
      event: 'item/created',
      eventId: 'evt_1',
      itemId: 'item-abc-123',
      clientId: 'client-x',
    });

    expect((out as Record<string, unknown>).itemId).toBeUndefined();
    expect(out.itemIdHash).toBe(expectedHashHex('item-abc-123'));
    expect(out.event).toBe('item/created');
    expect(out.eventId).toBe('evt_1');
    expect((out as Record<string, unknown>).clientId).toBe('client-x');
  });

  it('redaction-2: payload without itemId returns clone with no itemIdHash and no itemId key', async () => {
    const { redactPluggyPayload } = await import('@/lib/pluggyRedaction');
    const out = redactPluggyPayload({
      event: 'connector/status_updated',
      eventId: 'evt_2',
    });

    expect((out as Record<string, unknown>).itemId).toBeUndefined();
    expect(out.itemIdHash).toBeUndefined();
    expect(out.event).toBe('connector/status_updated');
    expect(out.eventId).toBe('evt_2');
  });

  it('redaction-3: leaves nested error.message verbatim (Phase 2 does not deep-scrub)', async () => {
    const { redactPluggyPayload } = await import('@/lib/pluggyRedaction');
    const out = redactPluggyPayload({
      event: 'item/error',
      eventId: 'evt_3',
      itemId: 'item-xyz',
      error: { code: 'X', message: 'msg with item-xyz inside' },
    });

    expect((out as Record<string, unknown>).itemId).toBeUndefined();
    expect(out.itemIdHash).toBe(expectedHashHex('item-xyz'));
    const error = (out as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('X');
    expect(error.message).toBe('msg with item-xyz inside');
  });

  it('redaction-4: does not mutate the caller input', async () => {
    const { redactPluggyPayload } = await import('@/lib/pluggyRedaction');
    const input = {
      event: 'item/created',
      eventId: 'evt_4',
      itemId: 'item-mutate-test',
    };
    redactPluggyPayload(input);
    expect(input.itemId).toBe('item-mutate-test');
    expect((input as Record<string, unknown>).itemIdHash).toBeUndefined();
  });
});
