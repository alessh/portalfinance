/**
 * Subprocess helper for env-assert integration test.
 *
 * This script is executed in a child process with a controlled set of
 * environment variables. It imports src/lib/env via a relative path
 * (tsconfig path aliases don't resolve with tsx + moduleResolution=bundler).
 * Exits 0 if the parse succeeds or non-zero (with OPS-04 message on stderr)
 * if env.ts throws.
 *
 * Note: src/lib/env.ts begins with `import 'server-only'` (plan 02-07
 * client-bundle leak guard). The `server-only` package throws unconditionally
 * when resolved through Node.js CommonJS — its `react-server` export
 * condition only fires under React Server Components or with ESM + the
 * `--conditions=react-server` Node flag. tsx loads everything via CJS, so
 * we short-circuit `server-only` by pre-populating require.cache with a
 * no-op stub BEFORE importing env.ts. This is test-fixture-only behavior
 * and does NOT affect production: the `server-only` enforcement still
 * fires whenever a client component or browser bundle attempts the import.
 */
import { createRequire } from 'node:module';
import Module from 'node:module';

// Pre-stub 'server-only' so the env loader can be imported from this
// non-React Node subprocess. This mirrors what Next.js's webpack alias
// does for Server Components, but at the Node module-resolver level.
const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve('server-only');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = (Module as unknown as { _cache: Record<string, NodeJS.Module> })._cache;
cache[serverOnlyPath] = {
  id: serverOnlyPath,
  filename: serverOnlyPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

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
