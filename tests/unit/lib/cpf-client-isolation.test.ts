/**
 * Regression test (Gap 02-07) — guards the client/server boundary of @/lib/cpf.
 *
 * The /connect ZodError (UAT Test 1) was caused by `cpf.ts` co-locating
 * pure-client `CPFSchema` with server-only `encryptAndHashCPF`. The fix
 * (plan 02-07) split the module; this test makes sure no future refactor
 * silently re-merges them.
 *
 * Strategy: walk the static import graph rooted at `@/lib/cpf` and assert
 * none of the reachable files import `@/lib/env` or `@/lib/crypto` (the two
 * server-only modules that triggered the ZodError when bundled to the client).
 *
 * NOT a runtime test — module-graph regression, not behavioral regression.
 *
 * Plan 02-10 update: FORBIDDEN_FROM_CLIENT now includes `@/lib/serverOnly`.
 * Plan 02-07's literal `import 'server-only';` in env.ts/crypto.ts was
 * replaced with a call to `assertServerOnly()` from `@/lib/serverOnly`,
 * which itself keeps the package import. The walker now flags any client
 * path reaching `@/lib/serverOnly` for the same reason it flagged
 * `@/lib/env`/`@/lib/crypto` before — defense-in-depth at the leaf.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = resolve(REPO_ROOT, 'src');

const FORBIDDEN_FROM_CLIENT = new Set([
  '@/lib/env',
  '@/lib/crypto',
  '@/lib/cpfServer',
  // Plan 02-10 — `serverOnly.ts` itself does `import 'server-only';`, so any
  // client-bundle path that reaches it would also fail the Next build. Add
  // it here so the walker keeps reporting the violation at the same node it
  // would have flagged before plan 02-10 (when env.ts/crypto.ts contained
  // the literal package import directly).
  '@/lib/serverOnly',
]);

const IMPORT_RE = /^\s*import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm;

function resolveAlias(spec: string, fromFile: string): string | null {
  if (spec.startsWith('@/')) {
    // Try .ts then .tsx then /index.ts
    const base = resolve(SRC_ROOT, spec.slice(2));
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      try {
        readFileSync(base + ext, 'utf8');
        return base + ext;
      } catch {
        /* try next */
      }
    }
    return null;
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = resolve(dirname(fromFile), spec);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      try {
        readFileSync(base + ext, 'utf8');
        return base + ext;
      } catch {
        /* try next */
      }
    }
    return null;
  }
  // Bare specifier (npm package) — out of scope for this guard.
  return null;
}

function collectImportSpecifiers(source: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function walk(entryAbs: string, visited: Set<string>, breadcrumbs: string[]): string[] {
  if (visited.has(entryAbs)) return [];
  visited.add(entryAbs);

  const source = readFileSync(entryAbs, 'utf8');
  const specifiers = collectImportSpecifiers(source);
  const violations: string[] = [];

  for (const spec of specifiers) {
    if (FORBIDDEN_FROM_CLIENT.has(spec)) {
      violations.push([...breadcrumbs, entryAbs, spec].join(' -> '));
      continue;
    }
    const resolved = resolveAlias(spec, entryAbs);
    if (resolved && resolved.startsWith(SRC_ROOT)) {
      violations.push(...walk(resolved, visited, [...breadcrumbs, entryAbs]));
    }
  }

  return violations;
}

describe('cpf module client-isolation (regression for /connect ZodError)', () => {
  it('@/lib/cpf does not transitively import @/lib/env or @/lib/crypto', () => {
    const entry = resolve(SRC_ROOT, 'lib/cpf.ts');
    const violations = walk(entry, new Set(), []);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('@/lib/cpfServer DOES import @/lib/crypto (sanity check that the test is real)', () => {
    const entry = resolve(SRC_ROOT, 'lib/cpfServer.ts');
    const violations = walk(entry, new Set(), []);
    // cpfServer is server-only; FORBIDDEN_FROM_CLIENT.has('@/lib/crypto') === true,
    // so walking from cpfServer MUST report a violation. If this returns [], the
    // walker is broken (e.g., import regex stopped matching) and the cpf.ts test
    // would silently pass for the wrong reason.
    expect(violations.length).toBeGreaterThan(0);
  });
});
