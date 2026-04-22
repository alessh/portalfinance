import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

export interface TestDb {
  url: string;
  container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
}

/**
 * Boot a disposable Postgres 16 container for an integration test.
 *
 * Pre-requisites:
 *   - Docker Desktop running with the WSL2 backend on Windows hosts
 *     (RESEARCH.md Pitfall 9). On macOS/Linux any Docker daemon works.
 *   - Network access to pull `postgres:16-alpine` on first run.
 *
 * Plan 01-01 will add a Drizzle migration runner. Until then, this fixture
 * boots an empty cluster and leaves schema setup to the caller.
 */
export async function startTestDb(): Promise<TestDb> {
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
        `Underlying error: ${(err as Error).message}`,
    );
  }

  const url = container.getConnectionUri();
  return {
    url,
    container,
    stop: async () => {
      await container.stop();
    },
  };
}
