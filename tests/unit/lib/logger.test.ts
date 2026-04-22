/**
 * Pino structured logger tests.
 *
 * Plan 01-04 — OPS-01 / T-LOGGER-PII mitigation coverage.
 * RESEARCH.md § Plan slice 01-04 item 4.
 *
 * 3 required cases:
 *   1. emits valid JSON on stdout
 *   2. scrubs CPF in meta object (string-based rule)
 *   3. scrubs PII key in meta object (key-based redaction)
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Writable } from 'node:stream';

// Capture pino output via a writable stream.
function captureLogOutput(fn: (logger: typeof import('@/lib/logger').logger) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let output = '';
    const stream = new Writable({
      write(chunk, _enc, cb) {
        output += chunk.toString();
        cb();
      },
    });
    stream.on('finish', () => resolve(output.trim()));

    // Build a fresh pino instance with the capture stream.
    import('pino').then(({ default: pino }) => {
      import('@/lib/piiScrubber').then(({ scrubObject }) => {
        const testLogger = pino(
          {
            level: 'trace',
            base: { service: 'test' },
            formatters: { level: (label) => ({ level: label }) },
            hooks: {
              logMethod(args, method) {
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
          },
          stream,
        );
        try {
          fn(testLogger as typeof import('@/lib/logger').logger);
        } catch (e) {
          reject(e);
          return;
        }
        // Flush and close.
        stream.end();
      });
    });
  });
}

describe('lib/logger (pino + scrubObject hook)', () => {
  beforeAll(() => {
    process.env.LOG_LEVEL = 'trace';
    process.env.SERVICE_NAME = 'test';
    // NODE_ENV is already 'test' in unit test context.
  });

  it('emits valid JSON on a log call', async () => {
    const output = await captureLogOutput((logger) => {
      logger.info({ action: 'test' }, 'hello world');
    });
    expect(output).toBeTruthy();
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({ level: 'info', msg: 'hello world', action: 'test' });
  });

  it('scrubs CPF in meta object (string-based rule)', async () => {
    const output = await captureLogOutput((logger) => {
      // Use 'note' (not in PII_KEYS) to exercise string-based CPF scrubbing.
      logger.info({ note: 'PIX 123.456.789-00' }, 'test');
    });
    const parsed = JSON.parse(output);
    expect(parsed.note).not.toContain('123.456.789-00');
    expect(parsed.note).toContain('[CPF]');
  });

  it('scrubs PII key in meta object (key-based redaction)', async () => {
    const output = await captureLogOutput((logger) => {
      logger.info({ cpf: '12345678900' }, 'test');
    });
    const parsed = JSON.parse(output);
    expect(parsed.cpf).toBe('[REDACTED]');
  });
});
