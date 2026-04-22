/**
 * Edge-compatible JSON logger.
 *
 * Plan 01-04 — OPS-01 / LGPD-06.
 *
 * The edge runtime (Next.js middleware) cannot import `pino` (Node module)
 * or `env.ts` (reads process.env at module load with Buffer). This wrapper
 * emits the same JSON log shape via `console.log(JSON.stringify(...))` and
 * passes every meta object through `scrubObject` before serialisation.
 *
 * Usage:
 *   import { logger } from '@/lib/logger.edge';
 *   logger.info({ path: req.nextUrl.pathname }, 'middleware hit');
 */
import { scrubObject } from '@/lib/piiScrubber';

function emit(level: string, obj: unknown, msg?: string): void {
  const meta =
    typeof obj === 'object' && obj !== null && !Array.isArray(obj)
      ? scrubObject(obj as Record<string, unknown>)
      : { value: typeof obj === 'string' ? obj : String(obj) };

  // Matches the pino JSON shape so log parsers receive consistent output.
  console.log(
    JSON.stringify({
      level,
      time: Date.now(),
      service: process.env.SERVICE_NAME ?? 'edge',
      msg: msg ?? '',
      ...meta,
    }),
  );
}

export const logger = {
  info: (obj: unknown, msg?: string) => emit('info', obj, msg),
  warn: (obj: unknown, msg?: string) => emit('warn', obj, msg),
  error: (obj: unknown, msg?: string) => emit('error', obj, msg),
  debug: (obj: unknown, msg?: string) => emit('debug', obj, msg),
};
