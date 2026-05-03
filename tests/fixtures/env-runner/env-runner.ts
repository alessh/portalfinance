/**
 * Subprocess helper for env-assert integration test.
 *
 * This script is executed in a child process with a controlled set of
 * environment variables. It imports `src/lib/env` via a relative path
 * (tsconfig path aliases don't resolve with tsx + moduleResolution=bundler).
 * Exits 0 if the parse succeeds or non-zero (with the OPS-04 message on
 * stderr) if env.ts throws.
 *
 * Plan 02-10 — the previous Module._cache pre-stub for `'server-only'` is
 * NO LONGER NEEDED. Plan 02-07 had added a literal `import 'server-only';`
 * to env.ts which would crash this subprocess on load; plan 02-10 replaced
 * that with `assertServerOnly()` from `@/lib/serverOnly` (a no-op under
 * tsx). This file is now a plain async loader.
 */
export {}; // mark as a module so `main` is file-scoped (avoids global merge with sibling fixtures)

async function main(): Promise<void> {
  try {
    // Use relative path to bypass tsconfig path alias resolution issues.
    // Path: tests/fixtures/env-runner -> ../../.. -> repo root -> src/lib/env
    await import('../../../src/lib/env');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(message + '\n');
    process.exit(1);
  }
}

main();
