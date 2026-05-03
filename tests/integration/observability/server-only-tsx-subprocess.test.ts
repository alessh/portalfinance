/**
 * Plan 02-10 — regression guard for the worker-boot crash documented in
 * 02-HUMAN-UAT.md Test 1 Gap.
 *
 * Spawns `tsx <fixture>.ts` in a subprocess with a populated env and
 * asserts:
 *   1. exit code 0
 *   2. stdout contains "OK"
 *   3. stderr does NOT contain "Client Component" (the canonical
 *      `server-only` package error message)
 *
 * If a future change reintroduces a top-level `import 'server-only';`
 * in env.ts or crypto.ts, this test fails with a clear stderr capture.
 *
 * Why integration project (not unit)?
 *   - Spawning a tsx subprocess is heavyweight (~2-4s on Windows, ~1s on
 *     Linux). The integration project already pays this cost via testcontainers.
 *   - The unit project runs under happy-dom, where `assertServerOnly()`
 *     itself would throw — we'd have to mock it, defeating the test.
 *   - The integration project (per plan 02-09) runs in singleFork sequential
 *     mode, so subprocess spawning is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/server-only/import-server-modules.ts');
// Plan 02-10 (INFO 1 of revision): use the absolute path to the tsx binary
// inside node_modules instead of `npx tsx`. Reasons:
//   - `npx` may not be on PATH in the spawn env on Windows (PowerShell vs.
//     cmd.exe vs. WSL).
//   - Resolving the binary directly is faster (no npx fetch / cache lookup).
//   - On Windows the binary is `tsx.cmd`; on POSIX it is `tsx` (no extension).
const TSX_BIN = resolve(
  REPO_ROOT,
  'node_modules/.bin/tsx' + (process.platform === 'win32' ? '.cmd' : ''),
);

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runTsx(env: Record<string, string>): Promise<SpawnResult> {
  return new Promise((resolveP) => {
    const child = spawn(TSX_BIN, [FIXTURE], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // shell: true is needed on Windows so .cmd shims resolve correctly.
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => {
      stdout += b.toString();
    });
    child.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    child.on('close', (code) => {
      resolveP({ code: code ?? -1, stdout, stderr });
    });
  });
}

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test:test@localhost:5432/portal_test',
  NEXTAUTH_SECRET: 'test-secret-at-least-32-chars-long-xxx',
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  CPF_HASH_PEPPER: 'test-pepper-at-least-32-chars-long-xyz',
};

describe('server-only tsx-subprocess regression (plan 02-10)', () => {
  it(
    'tsx subprocess can import @/lib/env and @/lib/crypto without a Client Component crash',
    async () => {
      const result = await runTsx(VALID_ENV);
      expect(
        result.stderr,
        `subprocess stderr was:\n${result.stderr}`,
      ).not.toMatch(/Client Component/i);
      expect(
        result.code,
        `exit code ${result.code}; stdout=${result.stdout}; stderr=${result.stderr}`,
      ).toBe(0);
      expect(result.stdout).toContain('OK');
    },
    { timeout: 30_000 },
  );
});
