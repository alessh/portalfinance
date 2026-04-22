/**
 * Worker entrypoint — Plan 01-03.
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
import { logger as log } from '@/lib/logger';

async function main() {
  const boss = await getBoss();

  // Register all Phase 1 workers
  await boss.work(QUEUES.DSR_ACKNOWLEDGE, { localConcurrency: 2 }, dsrAcknowledgeWorker);
  await boss.work(QUEUES.SEND_PASSWORD_RESET_EMAIL, { localConcurrency: 4 }, passwordResetEmailWorker);
  await boss.work(QUEUES.SEND_UNLOCK_EMAIL, { localConcurrency: 4 }, accountUnlockEmailWorker);
  await boss.work(QUEUES.SES_BOUNCE, { localConcurrency: 2 }, sesBounceWorker);

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
