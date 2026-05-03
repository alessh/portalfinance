/**
 * Server-only assertion helper.
 *
 * Plan 02-10 — gap closure for plan 02-07 overshoot. The previous approach
 * (literal `import 'server-only';` at the top of src/lib/env.ts and
 * src/lib/crypto.ts) crashed any non-RSC consumer because the `server-only`
 * package's CJS module throws unconditionally on load. The Next.js webpack /
 * turbopack alias rewrites it to a no-op for server bundles, but plain Node /
 * tsx (worker, db:migrate, e2e runner, ad-hoc scripts) loads the real CJS
 * module and crashes at module evaluation.
 *
 * Defense-in-depth model AFTER plan 02-10 (Rule 1 deviation — see SUMMARY):
 *
 *   1. STATIC compile-time guard — `src/lib/cpfServer.ts` retains its
 *      literal `import 'server-only';`. Any `'use client'` chain that
 *      reaches `cpfServer.ts` still fails the Next.js client build with
 *      the canonical "needs server-only" message. The walker test
 *      (`tests/unit/lib/cpf-client-isolation.test.ts`) extends this
 *      guarantee by statically forbidding ANY client path reaching
 *      `@/lib/env`, `@/lib/crypto`, `@/lib/cpfServer`, or `@/lib/serverOnly`
 *      — failing the unit suite before a regression can ship.
 *
 *   2. RUNTIME guard — `assertServerOnly()` below. If a true browser-shaped
 *      context somehow slips past the static guards (e.g., a happy-dom unit
 *      test that imports a server-only module without mocking it), the
 *      runtime throw catches it.
 *
 * NOTE: an earlier draft of this file kept `import 'server-only';` at the
 * top to add a third "leaf" compile-time guard, but that import crashes
 * tsx at module load (the package's CJS index.js throws unconditionally —
 * the `react-server` export condition only resolves under Next.js webpack
 * alias or with `node --conditions=react-server`). Removing the leaf
 * import is the only way to satisfy the plan's primary goal: tsx-direct
 * entrypoints (worker, db:migrate, e2e) can import `@/lib/env` and
 * `@/lib/crypto` without crashing. The compile-time guard at `cpfServer.ts`
 * + the walker provide equivalent coverage for every existing consumer.
 *
 * The runtime check requires BOTH `window` AND `window.document` to be
 * defined before it throws. This guards against:
 *   - SSR-shim polyfills that set `globalThis.window = {}` without Document.
 *   - Future Node versions adding a global `window` object (analogous to
 *     `navigator` in Node 22+) without a real Document.
 * Genuine browser bundles (and happy-dom) provide a Document instance and
 * therefore trip the guard — which is the desired behavior.
 */

const ERROR =
  'assertServerOnly: this module is server-only. It must NOT be imported ' +
  'from a Client Component, browser bundle, or any context where ' +
  '`window.document` is defined. If you reached this from happy-dom in a ' +
  'unit test, mock `@/lib/serverOnly` to a no-op or move the import behind ' +
  'a lazy `await import()` after asserting the test environment.';

export function assertServerOnly(): void {
  if (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { document?: unknown }).document !== 'undefined'
  ) {
    throw new Error(ERROR);
  }
}
