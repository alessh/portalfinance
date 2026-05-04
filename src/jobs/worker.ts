/**
 * Worker entrypoint — Plan 01-03 (Phase 1) + Plan 02-04 (Phase 2 sync worker).
 *
 * IMPORTANT: `@/lib/env` MUST be the first import. This enforces the
 * OPS-04 boot-time assertion (T-WORKER-BOOT-ENV): if any sandbox
 * credentials are present in a production environment, the Zod parse
 * inside env.ts throws synchronously before pg-boss.start() is ever called.
 *
 * Phase 1 workers registered:
 *   - dsr.acknowledge  → dsrAcknowledgeWorker
 *   - email.password_reset → passwordResetEmailWorker
 *   - email.account_unlock → accountUnlockEmailWorker
 *   - ses.bounce → sesBounceWorker
 *
 * Phase 2 workers registered (plan 02-04):
 *   - pluggy.sync → pluggySyncWorker (this plan)
 * Phase 2 workers registered (plan 02-05):
 *   - pluggy.transfer-detector → transferDetectorWorker
 *   - pluggy.fatura-detector → faturaDetectorWorker
 *   - pluggy.re-auth-notifier → reAuthNotifierWorker
 *   - pluggy.reconcile.stale-items → reconcileStaleItemsWorker
 *
 * TODO (Phase 6): Replace `tsx src/jobs/worker.ts` with a tsup-bundled
 * production binary (RESEARCH.md Decision 2 — tsup for worker bundle).
 * The `start:worker` script uses tsx for Phase 1 dev/staging.
 */
import '@/lib/env'; // MUST be first — OPS-04 env assertion
import { getBoss, QUEUES } from '@/jobs/boss';
import { dsrAcknowledgeWorker } from './workers/dsrAcknowledgeWorker';
import { passwordResetEmailWorker } from './workers/passwordResetEmailWorker';
import { accountUnlockEmailWorker } from './workers/accountUnlockEmailWorker';
import { sesBounceWorker } from './workers/sesBounceWorker';
import { pluggySyncWorker } from './workers/pluggySyncWorker';
import { transferDetectorWorker } from './workers/transferDetectorWorker';
import { faturaDetectorWorker } from './workers/faturaDetectorWorker';
import { reAuthNotifierWorker } from './workers/reAuthNotifierWorker';
import { reconcileStaleItemsWorker } from './workers/reconcileStaleItemsWorker';
import { itemReauthSucceededAuditWorker } from './workers/itemReauthSucceededAuditWorker';
import { logger as log } from '@/lib/logger';

async function main() {
  const boss = await getBoss();

  // Register all Phase 1 workers
  await boss.work(QUEUES.DSR_ACKNOWLEDGE, { localConcurrency: 2 }, dsrAcknowledgeWorker);
  await boss.work(QUEUES.SEND_PASSWORD_RESET_EMAIL, { localConcurrency: 4 }, passwordResetEmailWorker);
  await boss.work(QUEUES.SEND_UNLOCK_EMAIL, { localConcurrency: 4 }, accountUnlockEmailWorker);
  await boss.work(QUEUES.SES_BOUNCE, { localConcurrency: 2 }, sesBounceWorker);

  // Phase 2 workers (plan 02-04)
  // localConcurrency: 4 allows up to 4 concurrent syncs per worker instance.
  // Per-user singletonKey at enqueue (D-41) prevents the same user from having
  // more than 1 sync in flight at a time — independent of localConcurrency.
  await boss.work(QUEUES.PLUGGY_SYNC, { localConcurrency: 4 }, pluggySyncWorker);

  // Phase 2 workers (plan 02-05) — post-ingestion detector workers
  await boss.work(QUEUES.PLUGGY_TRANSFER_DETECTOR, { localConcurrency: 2 }, transferDetectorWorker);
  await boss.work(QUEUES.PLUGGY_FATURA_DETECTOR, { localConcurrency: 2 }, faturaDetectorWorker);
  await boss.work(QUEUES.PLUGGY_REAUTH_NOTIFIER, { localConcurrency: 2 }, reAuthNotifierWorker);
  await boss.work(QUEUES.PLUGGY_RECONCILE_STALE, { localConcurrency: 1 }, reconcileStaleItemsWorker);

  // Phase 2 worker (plan 02-12 — Concern #3): off-the-hot-path audit writer
  // for item/login_succeeded webhooks. Receiver enqueues, this worker writes.
  await boss.work(QUEUES.PLUGGY_REAUTH_AUDIT, { localConcurrency: 2 }, itemReauthSucceededAuditWorker);

  // D-38: hourly reconciliation cron at :00 BRT.
  // Enqueues PLUGGY_SYNC for items stale >12h (excluding broken items).
  // `tz: 'America/Sao_Paulo'` ensures the schedule runs in Brazilian Standard Time.
  await boss.schedule(
    QUEUES.PLUGGY_RECONCILE_STALE,
    '0 * * * *',
    {},
    { tz: 'America/Sao_Paulo' },
  );

  log.info({ queues: Object.values(QUEUES) }, 'worker started — registered queues');

  // Graceful shutdown on SIGTERM (Railway sends this on deploy/stop)
  const stop = async () => {
    log.info({}, 'worker stopping...');
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  log.error({ error: String(err) }, 'worker failed');
  process.exit(1);
});
