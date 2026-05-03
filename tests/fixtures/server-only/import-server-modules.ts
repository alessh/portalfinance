/**
 * Plan 02-10 fixture — exercises the server-only import surface from a tsx
 * subprocess (plain Node CJS resolution, NOT Next.js webpack).
 *
 * If plan 02-07's `import 'server-only';` were still at the top of env.ts /
 * crypto.ts, this script would crash at module load with:
 *   "Error: This module cannot be imported from a Client Component module."
 *
 * After plan 02-10, env.ts and crypto.ts use `assertServerOnly()` instead.
 * Under tsx (no DOM), the helper is a no-op — both imports succeed and the
 * subprocess prints `OK` and exits 0.
 *
 * Invoked from
 * tests/integration/observability/server-only-tsx-subprocess.test.ts.
 */
async function main(): Promise<void> {
  try {
    // Use relative paths so tsx's bundler-mode path-alias resolution does
    // not interfere. Relative is identical to what env-runner.ts uses.
    await import('../../../src/lib/env');
    await import('../../../src/lib/crypto');
    process.stdout.write('OK\n');
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(message + '\n');
    process.exit(1);
  }
}

main();
