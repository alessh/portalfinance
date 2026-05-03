import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

export interface TestDb {
  url: string;
  container: StartedPostgreSqlContainer;
  /**
   * Per-suite `afterAll` hooks call this. With the singleton + globalSetup
   * model (plan 02-09), individual suite teardown is a no-op — the shared
   * container survives until vitest globalSetup teardown runs.
   */
  stop: () => Promise<void>;
}

/**
 * Process-level cached promise — singleton container handle.
 *
 * Resolves to the started TestDb the first time `startTestDb()` is called
 * within a process; every subsequent call returns the same promise (so all
 * 22 integration suites share ONE Postgres container under
 * `singleFork: true`).
 *
 * Stored on `globalThis` (not module scope) because several Pluggy
 * integration suites call `vi.resetModules()` in `beforeEach` to make
 * `vi.doMock('@/services/PluggyService', ...)` re-apply per test. A
 * module-scope `let _started` would be cleared on every reset, so each
 * post-reset suite would boot a fresh container (observed: 13 leaked
 * containers per run pre-fix). globalThis survives `vi.resetModules`,
 * so the singleton remains intact.
 *
 * If the first start rejects, the rejection is cached too — every suite
 * sees the same clear error rather than 22 independent timeout failures.
 */
const SINGLETON_KEY = '__portalFinanceTestDb_v1';

interface TestDbGlobalCache {
  [SINGLETON_KEY]?: Promise<TestDb> | null;
}

function getCache(): Promise<TestDb> | null {
  return (globalThis as unknown as TestDbGlobalCache)[SINGLETON_KEY] ?? null;
}

function setCache(value: Promise<TestDb> | null): void {
  (globalThis as unknown as TestDbGlobalCache)[SINGLETON_KEY] = value;
}

/**
 * Boot a disposable Postgres 16 container for integration tests.
 *
 * Pre-requisites:
 *   - Docker Desktop with the WSL2 backend on Windows (RESEARCH.md Pitfall 9).
 *   - Network access to pull `postgres:16-alpine` on first run.
 *
 * Plan 02-09: this is now a process-level singleton. The first call within
 * a vitest process boots the container; every subsequent call returns the
 * same handle. Suite-level `afterAll(() => td.stop())` is a no-op — the
 * shared container survives until vitest globalSetup teardown.
 */
export function startTestDb(): Promise<TestDb> {
  const cached = getCache();
  if (cached) return cached;
  const fresh = bootContainer();
  setCache(fresh);
  return fresh;
}

async function bootContainer(): Promise<TestDb> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('portal_test')
      .withUsername('test')
      .withPassword('test')
      .start();
  } catch (err) {
    throw new Error(
      `[startTestDb] Failed to start Postgres testcontainer. Is Docker running?\n` +
        `On Windows, Docker Desktop with the WSL2 backend is required.\n` +
        `If a previous run leaked containers, clean up with:\n` +
        `  docker ps --filter "ancestor=postgres:16-alpine" -q | xargs -r docker rm -f\n` +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  const url = container.getConnectionUri();
  return {
    url,
    container,
    // No-op: lifecycle is owned by the globalSetup teardown.
    stop: async () => {
      /* shared container — see tests/fixtures/integration-globals.ts */
    },
  };
}

/**
 * Vitest globalSetup teardown helper. NEVER call from a test file.
 *
 * Stops the shared container (if it was started) and clears the singleton
 * so a re-run within the same Node process (rare — vitest spawns a fresh
 * process per CLI invocation) starts cleanly.
 */
export async function stopSharedTestDb(): Promise<void> {
  const cached = getCache();
  if (!cached) return;
  try {
    const td = await cached;
    await td.container.stop();
  } catch {
    // Swallow on teardown — testcontainer Ryuk reaper will clean up regardless.
  } finally {
    setCache(null);
  }
}
