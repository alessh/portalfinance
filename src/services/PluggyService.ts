/**
 * PluggyService — the ONLY module that holds plaintext Pluggy item IDs.
 *
 * Plan 02-02 — CONN-01, CONN-07, Pitfalls P4 (encrypt pluggy_item_id),
 * P13 (no PII in logs), T-02-A/B/C/D/E threat mitigations.
 *
 * Design rules:
 * 1. Decrypt-on-use: item_id_enc is decrypted inside each method scope only.
 *    The plaintext NEVER escapes this module (returned values, error messages,
 *    log fields, Sentry events).
 * 2. Every public method:
 *    a. Wraps the SDK call in a Sentry.startSpan.
 *    b. Emits a logger.info with hashed IDs (hashUserIdForSentry).
 *    c. Strips any plaintext itemId from SDK error messages via scrub_plaintext().
 * 3. Lazy singleton SDK client — credential selection via pluggyEnv.ts (D-40).
 *
 * NEVER add a method that returns the plaintext item ID. Callers that need
 * to pass the ID back to Pluggy (e.g., webhooks, workers) must call the
 * relevant PluggyService method directly.
 */
import * as Sentry from '@sentry/nextjs';
import { PluggyClient } from 'pluggy-sdk';
import { decryptCPF as decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { hashUserIdForSentry as hashId } from '@/lib/sentry';
import { getPluggyClientId, getPluggyClientSecret } from '@/lib/pluggyEnv';

// ---------------------------------------------------------------------------
// SDK client singleton (lazy)
// ---------------------------------------------------------------------------

let _client: PluggyClient | null = null;

function getClient(): PluggyClient {
  if (_client) return _client;
  _client = new PluggyClient({
    clientId: getPluggyClientId(),
    clientSecret: getPluggyClientSecret(),
  });
  return _client;
}

// ---------------------------------------------------------------------------
// PluggyError — plaintext-safe SDK error wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps SDK errors so .message NEVER carries plaintext Pluggy item IDs.
 * scrub_plaintext() replaces any occurrence of the itemId substring with
 * '[redacted-pluggy-item-id]' before the error leaves this module (T-02-B).
 */
export class PluggyError extends Error {
  readonly sdk_status?: number;

  constructor(message: string, sdk_status?: number) {
    super(message);
    this.name = 'PluggyError';
    this.sdk_status = sdk_status;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Replace every occurrence of `plaintext` in `message` with a redaction token.
 * Called unconditionally on every error path — if plaintext is undefined the
 * message is returned unchanged.
 */
function scrub_plaintext(message: string, plaintext: string | undefined): string {
  if (!plaintext) return message;
  return message.split(plaintext).join('[redacted-pluggy-item-id]');
}

// ---------------------------------------------------------------------------
// PluggyService
// ---------------------------------------------------------------------------

export class PluggyService {
  /**
   * Issue a Pluggy Connect token for the initial bank-connection flow.
   *
   * When `reconnect_item_id_enc` is provided the token is scoped to that
   * specific item (re-auth flow, D-30). The plaintext itemId is decrypted
   * inside this method and NEVER returned or logged.
   *
   * SDK: `createConnectToken(itemId?, options?)` — confirmed in 02-01-SUMMARY.
   */
  async createConnectToken(args: {
    user_id: string;
    reconnect_item_id_enc?: Buffer;
  }): Promise<{ connect_token: string }> {
    return Sentry.startSpan(
      { op: 'pluggy.create_connect_token', name: 'PluggyService.createConnectToken' },
      async () => {
        const item_id = args.reconnect_item_id_enc
          ? decrypt(args.reconnect_item_id_enc)
          : undefined;
        try {
          // SDK: createConnectToken(itemId?, options?) → { accessToken: string }
          // Confirmed in 02-01-SUMMARY. No expiresAt in SDK type definition.
          const t = await getClient().createConnectToken(item_id);
          logger.info(
            {
              event: 'pluggy_connect_token_created',
              user_id_hashed: hashId(args.user_id),
              reconnect: !!item_id,
            },
            'pluggy connect token created',
          );
          return { connect_token: t.accessToken };
        } catch (err) {
          throw new PluggyError(
            scrub_plaintext(String(err), item_id),
            (err as { status?: number }).status,
          );
        }
      },
    );
  }

  /**
   * Fetch a Pluggy item (bank connection) by encrypted item ID.
   *
   * SDK: `fetchItem(id)` — confirmed in 02-01-SUMMARY.
   */
  async fetchItem(args: {
    user_id: string;
    item_id_enc: Buffer;
  }) {
    return Sentry.startSpan(
      { op: 'pluggy.fetch_item', name: 'PluggyService.fetchItem' },
      async () => {
        const item_id = decrypt(args.item_id_enc);
        try {
          const item = await getClient().fetchItem(item_id);
          logger.info(
            {
              event: 'pluggy_item_fetched',
              user_id_hashed: hashId(args.user_id),
              item_id_hashed: hashId(item_id),
              status: item.status,
            },
            'pluggy item fetched',
          );
          return item;
        } catch (err) {
          throw new PluggyError(
            scrub_plaintext(String(err), item_id),
            (err as { status?: number }).status,
          );
        }
      },
    );
  }

  /**
   * Fetch all accounts for a Pluggy item by encrypted item ID.
   *
   * SDK: `fetchAccounts(itemId, type?)` — confirmed in 02-01-SUMMARY.
   */
  async fetchAccounts(args: {
    user_id: string;
    item_id_enc: Buffer;
  }) {
    return Sentry.startSpan(
      { op: 'pluggy.fetch_accounts', name: 'PluggyService.fetchAccounts' },
      async () => {
        const item_id = decrypt(args.item_id_enc);
        try {
          const result = await getClient().fetchAccounts(item_id);
          logger.info(
            {
              event: 'pluggy_accounts_fetched',
              user_id_hashed: hashId(args.user_id),
              item_id_hashed: hashId(item_id),
              count: result.results?.length ?? 0,
            },
            'pluggy accounts fetched',
          );
          return result;
        } catch (err) {
          throw new PluggyError(
            scrub_plaintext(String(err), item_id),
            (err as { status?: number }).status,
          );
        }
      },
    );
  }

  /**
   * Cursor-paginated transaction fetch for a single account.
   *
   * SDK: `fetchTransactionsCursor(accountId, options?)` — cursor-based,
   * confirmed in 02-01-SUMMARY. The `from`/`to` date range and optional
   * `cursor` string map to the SDK options object.
   *
   * The item_id_enc is required for Sentry span attribution and audit logging
   * only; it is NOT passed to the SDK call (which takes accountId directly).
   */
  async fetchTransactions(args: {
    user_id: string;
    item_id_enc: Buffer;
    account_id: string;
    date_from: Date;
    cursor?: string;
  }) {
    return Sentry.startSpan(
      { op: 'pluggy.fetch_transactions', name: 'PluggyService.fetchTransactions' },
      async () => {
        const item_id = decrypt(args.item_id_enc);
        try {
          // SDK: fetchTransactionsCursor(accountId, options?)
          // TransactionCursorFilters: { dateFrom?, createdAtFrom?, after? }
          // CursorPageResponse<Transaction>: { results, next: string | null }
          const result = await getClient().fetchTransactionsCursor(args.account_id, {
            dateFrom: args.date_from.toISOString().split('T')[0],
            ...(args.cursor ? { after: args.cursor } : {}),
          });
          logger.info(
            {
              event: 'pluggy_transactions_fetched',
              user_id_hashed: hashId(args.user_id),
              item_id_hashed: hashId(item_id),
              account_id: args.account_id,
              count: result.results?.length ?? 0,
              has_next_cursor: !!result.next,
            },
            'pluggy transactions fetched',
          );
          return result;
        } catch (err) {
          throw new PluggyError(
            scrub_plaintext(String(err), item_id),
            (err as { status?: number }).status,
          );
        }
      },
    );
  }

  /**
   * Delete a Pluggy item (disconnect bank account) by encrypted item ID.
   *
   * Emits a log line with hashed item_id. The plaintext NEVER appears in
   * any log field — asserted by Test 3 unit test (T-02-A).
   *
   * SDK: `deleteItem(id)` — confirmed in 02-01-SUMMARY.
   */
  async deleteItem(args: {
    user_id: string;
    item_id_enc: Buffer;
  }): Promise<void> {
    return Sentry.startSpan(
      { op: 'pluggy.delete_item', name: 'PluggyService.deleteItem' },
      async () => {
        const item_id = decrypt(args.item_id_enc);
        try {
          await getClient().deleteItem(item_id);
          logger.info(
            {
              event: 'pluggy_item_deleted',
              user_id_hashed: hashId(args.user_id),
              item_id_hashed: hashId(item_id),
            },
            'pluggy item deleted',
          );
        } catch (err) {
          throw new PluggyError(
            scrub_plaintext(String(err), item_id),
            (err as { status?: number }).status,
          );
        }
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor (mirrors mailer.ts pattern)
// ---------------------------------------------------------------------------

let _service: PluggyService | null = null;

export function getPluggyService(): PluggyService {
  if (_service) return _service;
  _service = new PluggyService();
  return _service;
}
