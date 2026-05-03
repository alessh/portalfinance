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
 * Two layers of defense, both preserved here:
 *
 *   1. The literal `import 'server-only';` below. When a `'use client'`
 *      module transitively imports this file, Next.js's bundler still fails
 *      the build with the canonical message:
 *        "You're importing a component that needs server-only. That only
 *         works in a Server Component which is not supported in a Client
 *         Component."
 *
 *   2. The `assertServerOnly()` runtime check. If a true browser-shaped
 *      context somehow slips past the build guard (e.g., a happy-dom unit
 *      test that imports a server-only module without mocking it), the
 *      runtime throw catches it.
 *
 * IMPORTANT: this file is the ONLY src/ module that imports `'server-only'`
 * directly (cpfServer.ts also keeps it for defense-in-depth). Every other
 * server-only module calls `assertServerOnly()`. That way:
 *   - Next.js client builds still fail at the leaf import.
 *   - Plain Node / tsx callers walk through this helper, see no DOM, and pass.
 *
 * The runtime check requires BOTH `window` AND `window.document` to be
 * defined before it throws. This guards against:
 *   - SSR-shim polyfills that set `globalThis.window = {}` without Document.
 *   - Future Node versions adding a global `window` object (analogous to
 *     `navigator` in Node 22+) without a real Document.
 * Genuine browser bundles (and happy-dom) provide a Document instance and
 * therefore trip the guard — which is the desired behavior.
 */
import 'server-only';

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
