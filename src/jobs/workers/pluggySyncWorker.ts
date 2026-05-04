/**
 * Pluggy sync worker — fetches accounts + transactions from Pluggy and
 * upserts them into the local DB.
 *
 * Plan 02-04 — TX-01 (dedup), TX-02 (PENDING→POSTED), TX-03 (history depth),
 * Pitfalls P1, P2, P4, P5, P9.
 *
 * Job payload shapes:
 *   Direct enqueue (from /api/pluggy/items):
 *     { user_id, item_id (internal UUID), trigger }
 *   Webhook-driven enqueue (from webhook receiver):
 *     { webhook_event_id, item_id_hash_hex (lower-hex of HMAC), trigger }
 *
 * Design notes:
 *   - item_id_hash_hex is the HMAC the receiver already computed via
 *     hashPluggyItemId(plaintext). The worker hex-decodes it and looks up the
 *     internal pluggy_items row by pluggy_item_id_hash. Concern #1 forbids
 *     plaintext pluggy_item_id from appearing in pg-boss job rows. Workers
 *     NEVER trust webhook payload data directly — they always re-fetch via
 *     PluggyService.
 *   - pluggy_item_id_enc is the encrypted bytea passed to PluggyService methods.
 *     PluggyService is the ONLY decrypt boundary (P4).
 *   - ON CONFLICT DO UPDATE preserves is_transfer / is_credit_card_payment /
 *     transfer_pair_id (T-02-E — set only by post-ingestion detectors in 02-05).
 *   - trigger='reconnect' bypasses cooldown and uses 12-month sync window (D-30).
 *   - trigger='first_connect' also uses 12-month window.
 *   - Incremental syncs use last_synced_at - 7 days window (TX-02 overlap).
 */
import * as Sentry from '@sentry/nextjs';
import { sql, eq } from 'drizzle-orm';
import type { Job } from 'pg-boss';
import type { Transaction as PluggyTransaction } from 'pluggy-sdk';
import { db } from '@/db';
import { accounts, pluggy_items, transactions } from '@/db/schema';
import { enqueue, QUEUES } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { hashUserIdForSentry as hashId } from '@/lib/sentry';
import { getPluggyService } from '@/services/PluggyService';

// ---------------------------------------------------------------------------
// Payload type
// ---------------------------------------------------------------------------

interface SyncJobPayload {
  user_id?: string;          // direct enqueue path (from /api/pluggy/items)
  item_id?: string;          // internal pluggy_items UUID (direct path)
  webhook_event_id?: string; // webhook-driven path
  item_id_hash_hex?: string; // lower-hex of hashPluggyItemId(plaintext) — set by webhook receiver (Concern #1)
  trigger?: 'first_connect' | 'webhook' | 'manual' | 'reconcile' | 'reconnect';
}

// ---------------------------------------------------------------------------
// Sync window constants (D-26, TX-02)
// ---------------------------------------------------------------------------

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Account type mapper (Pluggy SDK → internal enum)
// ---------------------------------------------------------------------------

/**
 * Map Pluggy account `type` field to our internal account_type enum.
 *
 * Verified against pluggy-sdk@0.85.2 SDK types (02-01-SUMMARY):
 *   BANK → CHECKING (Pluggy aggregates checking/savings under BANK; subtype distinguishes)
 *   CREDIT → CREDIT_CARD
 *   LOAN → LOAN
 *   INVESTMENT → INVESTMENT
 *
 * Note: Pluggy subtype values include CHECKING_ACCOUNT, SAVINGS_ACCOUNT, etc.
 * The `subtype` field is stored verbatim in accounts.subtype for Phase 4 use.
 */
function mapAccountType(
  t: string,
): 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD' | 'LOAN' | 'INVESTMENT' | 'OTHER' {
  switch (t) {
    case 'BANK':
      return 'CHECKING';
    case 'CREDIT':
      return 'CREDIT_CARD';
    case 'LOAN':
      return 'LOAN';
    case 'INVESTMENT':
      return 'INVESTMENT';
    default:
      return 'OTHER';
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export async function pluggySyncWorker(jobs: Job<SyncJobPayload>[]): Promise<void> {
  for (const job of jobs) {
    const start = Date.now();
    let item_row: typeof pluggy_items.$inferSelect | undefined;

    try {
      // -----------------------------------------------------------------------
      // 1. Resolve internal pluggy_items row
      //    - Direct path: item_id is the internal UUID
      //    - Webhook path: item_id_hash_hex is the receiver-computed HMAC hex →
      //      decode and look up by pluggy_item_id_hash (Concern #1).
      // -----------------------------------------------------------------------
      if (job.data.item_id) {
        item_row = await db.query.pluggy_items.findFirst({
          where: eq(pluggy_items.id, job.data.item_id),
        });
      } else if (job.data.item_id_hash_hex) {
        // Concern #1: payload arrived WITHOUT plaintext pluggy_item_id; the
        // receiver already produced the HMAC. Hex-decode and look up directly.
        const hash_buf = Buffer.from(job.data.item_id_hash_hex, 'hex');
        item_row = await db.query.pluggy_items.findFirst({
          where: eq(pluggy_items.pluggy_item_id_hash, hash_buf),
        });
      } else if (job.data.user_id) {
        // Fallback: caller passed user_id but not item_id — not standard but defensively handled
        logger.warn(
          { event: 'sync_skipped', reason: 'missing_item_id', job_id: job.id },
          'sync job missing item_id and item_id_hash_hex',
        );
        continue;
      } else {
        // WR-02 (review fix): payload contained none of item_id, item_id_hash_hex,
        // or user_id. Previously item_row stayed undefined and the next guard
        // silently swallowed the job with reason='item_not_found', masking a
        // miscoded enqueue call. Log explicitly at error level — the job is
        // unrecoverable (bad payload), so we do NOT throw (pg-boss would just
        // retry with the same broken payload until the retry budget is
        // exhausted), but the log is loud enough for ops to notice.
        logger.error(
          { event: 'sync_skipped', reason: 'empty_payload', job_id: job.id },
          'sync job has no item_id, item_id_hash_hex, or user_id — cannot resolve item',
        );
        continue;
      }

      if (!item_row) {
        logger.warn(
          { event: 'sync_skipped', reason: 'item_not_found', job_id: job.id },
          'pluggy item not found — skipping job',
        );
        continue;
      }

      // -----------------------------------------------------------------------
      // 2. Skip broken items (Pitfall P2)
      //    LOGIN_ERROR / WAITING_USER_INPUT items are not healthy for sync.
      //    Worker returns early and emits sync_failed log.
      // -----------------------------------------------------------------------
      if (
        item_row.status === 'LOGIN_ERROR' ||
        item_row.status === 'WAITING_USER_INPUT'
      ) {
        logger.warn(
          {
            event: 'sync_failed',
            reason: 'item_broken',
            status: item_row.status,
            user_id_hashed: hashId(item_row.user_id),
            item_id_hashed: hashId(item_row.id),
          },
          'sync skipped — item is not in a healthy state',
        );
        continue;
      }

      const trigger = job.data.trigger ?? 'webhook';

      logger.info(
        {
          event: 'sync_started',
          user_id_hashed: hashId(item_row.user_id),
          item_id_hashed: hashId(item_row.id),
          trigger,
        },
        'pluggy sync started',
      );

      // -----------------------------------------------------------------------
      // 3. D-30: reconnect path — emit cooldown_bypassed audit BEFORE any SDK call.
      //    Auditors can correlate this with the 'item_reauth_succeeded' row
      //    from the webhook receiver.
      // -----------------------------------------------------------------------
      if (trigger === 'reconnect') {
        const { recordAudit } = await import('@/lib/auditLog');
        await recordAudit({
          user_id: item_row.user_id,
          action: 'manual_sync_triggered',
          metadata: {
            item_id: item_row.id,
            cooldown_bypassed: true,
            trigger: 'reconnect',
          },
        });
      }

      // -----------------------------------------------------------------------
      // 4. Mark item as UPDATING during the sync (D-21)
      // -----------------------------------------------------------------------
      await db
        .update(pluggy_items)
        .set({ status: 'UPDATING', updated_at: new Date() })
        .where(eq(pluggy_items.id, item_row.id));

      // -----------------------------------------------------------------------
      // 5. Main sync work — wrapped in a Sentry span (D-47, Pattern S8)
      // -----------------------------------------------------------------------
      const result = await Sentry.startSpan(
        {
          op: 'pluggy.sync',
          name: 'pluggy-sync-worker',
          attributes: { trigger },
        },
        async () => {
          const svc = getPluggyService();

          // -------------------------------------------------------------------
          // 5a. Fetch accounts from Pluggy → upsert into accounts table
          // -------------------------------------------------------------------
          const acct_resp = await svc.fetchAccounts({
            user_id: item_row!.user_id,
            item_id_enc: item_row!.pluggy_item_id_enc,
          });

          for (const a of acct_resp.results) {
            await db
              .insert(accounts)
              .values({
                user_id: item_row!.user_id,
                pluggy_item_id: item_row!.id,
                pluggy_account_id: a.id,
                type: mapAccountType(a.type),
                subtype: a.subtype ?? null,
                name: a.name,
                currency: a.currencyCode ?? 'BRL',
                balance: String(Math.abs(a.balance ?? 0)),
                credit_limit:
                  a.creditData?.creditLimit != null
                    ? String(a.creditData.creditLimit)
                    : null,
                owner: a.owner ?? null,
              })
              .onConflictDoUpdate({
                // WR-03: target is (user_id, pluggy_account_id) so joint
                // accounts shared by two users do not collide globally — the
                // unique index was widened to include user_id in migration
                // 0002_02_account_unique_per_user.
                target: [accounts.user_id, accounts.pluggy_account_id],
                set: {
                  name: sql.raw('excluded.name'),
                  balance: sql.raw('excluded.balance'),
                  credit_limit: sql.raw('excluded.credit_limit'),
                  updated_at: sql`now()`,
                },
              });
          }

          // -------------------------------------------------------------------
          // 5b. Determine sync window (D-26, TX-02 overlap, D-30 reconnect)
          // -------------------------------------------------------------------
          const now = new Date();
          const from_initial = new Date(now.getTime() - TWELVE_MONTHS_MS);
          const from_incremental = item_row!.last_synced_at
            ? new Date(item_row!.last_synced_at.getTime() - SEVEN_DAYS_MS)
            : from_initial;
          const date_from =
            trigger === 'first_connect' || trigger === 'reconnect'
              ? from_initial
              : from_incremental;

          // -------------------------------------------------------------------
          // 5c. Cursor-paginated transaction fetch per account → upsert
          // -------------------------------------------------------------------
          let transactions_added = 0;

          for (const a of acct_resp.results) {
            // Look up internal account row to get the FK
            const local_acct = await db.query.accounts.findFirst({
              where: eq(accounts.pluggy_account_id, a.id),
              columns: { id: true },
            });
            if (!local_acct) continue;

            let cursor: string | undefined = undefined;
            do {
              const tx_resp = await svc.fetchTransactions({
                user_id: item_row!.user_id,
                item_id_enc: item_row!.pluggy_item_id_enc,
                account_id: a.id,
                date_from,
                cursor,
              });

              if (tx_resp.results.length > 0) {
                const rows = (tx_resp.results as PluggyTransaction[]).map((t) => ({
                    user_id: item_row!.user_id,
                    account_id: local_acct.id,
                    pluggy_transaction_id: t.id,
                    type: (t.type === 'CREDIT' ? 'CREDIT' : 'DEBIT') as 'DEBIT' | 'CREDIT',
                    amount: String(Math.abs(t.amount ?? 0)),
                    currency: t.currencyCode ?? 'BRL',
                    description: t.description ?? '',
                    description_raw: t.descriptionRaw ?? null,
                    merchant_name: t.merchant?.name ?? null,
                    merchant_cnpj: t.merchant?.cnpj ?? null,
                    posted_at: t.date, // SDK type: Date (already a Date object)
                    status: (t.status === 'POSTED' ? 'POSTED' : 'PENDING') as
                      | 'POSTED'
                      | 'PENDING',
                    pluggy_category: t.category ?? null,
                    payment_method: t.paymentData?.paymentMethod ?? null,
                    raw_payload: t as Record<string, unknown>,
                  }),
                );

                // TX-01: ON CONFLICT (pluggy_transaction_id) DO UPDATE
                // CRITICAL: DO NOT update is_transfer / is_credit_card_payment /
                // transfer_pair_id — these are set exclusively by the detector workers
                // (02-05). Overwriting them here would silently discard detection results.
                await db
                  .insert(transactions)
                  .values(rows)
                  .onConflictDoUpdate({
                    target: transactions.pluggy_transaction_id,
                    set: {
                      status: sql.raw('excluded.status'),
                      amount: sql.raw('excluded.amount'),
                      description: sql.raw('excluded.description'),
                      description_raw: sql.raw('excluded.description_raw'),
                      posted_at: sql.raw('excluded.posted_at'),
                      raw_payload: sql.raw('excluded.raw_payload'),
                      updated_at: sql`now()`,
                      // DO NOT touch is_transfer / is_credit_card_payment / transfer_pair_id
                    },
                  });

                transactions_added += rows.length;
              }

              // Walk cursor pagination until exhausted (null cursor = last page)
              cursor = tx_resp.next ?? undefined;
            } while (cursor);
          }

          return { transactions_added };
        },
      );

      // -----------------------------------------------------------------------
      // 6. Flip item status + set last_synced_at (and last_manual_sync_at on
      //    successful manual triggers — Concern #12, plan 02-18). The manual-
      //    sync cooldown route reads `last_manual_sync_at`, NOT `last_synced_at`,
      //    so failed manual attempts (the worker threw before reaching here)
      //    do not cool down and recent webhook/reconcile syncs do not block
      //    a subsequent manual sync.
      // -----------------------------------------------------------------------
      const sync_completed_at = new Date();
      const update_set: {
        status: 'UPDATED';
        last_synced_at: Date;
        updated_at: Date;
        last_manual_sync_at?: Date;
      } = {
        status: 'UPDATED',
        last_synced_at: sync_completed_at,
        updated_at: sync_completed_at,
      };
      if (trigger === 'manual') {
        update_set.last_manual_sync_at = sync_completed_at;
      }
      await db
        .update(pluggy_items)
        .set(update_set)
        .where(eq(pluggy_items.id, item_row.id));

      // -----------------------------------------------------------------------
      // 7. Enqueue transfer + fatura detectors (02-05 workers)
      // -----------------------------------------------------------------------
      await enqueue(QUEUES.PLUGGY_TRANSFER_DETECTOR, { user_id: item_row.user_id });
      await enqueue(QUEUES.PLUGGY_FATURA_DETECTOR, { user_id: item_row.user_id });

      logger.info(
        {
          event: 'sync_completed',
          user_id_hashed: hashId(item_row.user_id),
          item_id_hashed: hashId(item_row.id),
          duration_ms: Date.now() - start,
          transactions_added: result.transactions_added,
        },
        'pluggy sync completed',
      );
    } catch (err) {
      const sdk_status =
        (err as { sdk_status?: number }).sdk_status ??
        (err as { status?: number }).status;

      logger.error(
        {
          event: 'sync_failed',
          reason: sdk_status === 429 ? 'rate_limited' : 'sdk_error',
          status: sdk_status,
          user_id_hashed: item_row ? hashId(item_row.user_id) : undefined,
          item_id_hashed: item_row ? hashId(item_row.id) : undefined,
          error: String(err),
        },
        'pluggy sync failed',
      );

      if (item_row) {
        await db
          .update(pluggy_items)
          .set({ last_error_at: new Date() })
          .where(eq(pluggy_items.id, item_row.id));
      }

      // Re-throw so pg-boss retries the job with backoff (P9)
      throw err;
    }
  }
}
