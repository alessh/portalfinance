/**
 * Subprocess helper for env-assert integration test.
 *
 * This script is executed in a child process with a controlled set of
 * environment variables. It imports src/lib/env via a relative path
 * (tsconfig path aliases don't resolve with tsx + moduleResolution=bundler).
 * Exits 0 if the parse succeeds or non-zero (with OPS-04 message on stderr)
 * if env.ts throws.
 */
async function main() {
  try {
    // Use relative path to bypass tsconfig path alias resolution issues.
    // Path: tests/fixtures/env-runner → ../../.. → repo root → src/lib/env
    await import('../../../src/lib/env');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(message + '\n');
    process.exit(1);
  }
}

main();
