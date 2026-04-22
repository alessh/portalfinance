/**
 * Structured JSON logger — pino (Node runtime).
 *
 * Plan 01-04 — OPS-01 / LGPD-06.
 *
 * PII scrubbing is applied via the `hooks.logMethod` hook: every meta
 * object passed as the first argument to a log call is passed through
 * `scrubObject` before pino serialises it.
 *
 * IMPORTANT: This module imports `env` which is SERVER-ONLY. Do NOT import
 * this from any client component or page — use `src/lib/logger.edge.ts`
 * for edge-runtime middleware instead.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info({ userId, action: 'signup' }, 'user signed up');
 *
 * pino-pretty is available as a dev dependency for local readability:
 *   NODE_ENV=development pnpm dev | pino-pretty
 * Do NOT enable pino-pretty in production — it breaks JSON parsers
 * (RESEARCH.md Landmine 01-04).
 */
import pino from 'pino';
import { scrubObject } from '@/lib/piiScrubber';
import { env } from '@/lib/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: env.SERVICE_NAME },
  formatters: {
    level: (label) => ({ level: label }),
  },
  hooks: {
    logMethod(
      args: Parameters<pino.LogFn>,
      method: pino.LogFn,
    ) {
      // If the first argument is an object (meta), scrub it.
      if (
        args.length > 0 &&
        typeof args[0] === 'object' &&
        args[0] !== null &&
        !Array.isArray(args[0])
      ) {
        args[0] = scrubObject(args[0]) as typeof args[0];
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (method as any).apply(this, args);
    },
  },
});
