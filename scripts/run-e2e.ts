/**
 * E2E test runner — boots a testcontainers Postgres, runs migrations,
 * writes the connection URL into `.env.local` BEFORE spawning either
 * Playwright OR the webServer, then invokes Playwright. Cleans up
 * deterministically on exit.
 *
 * The two-stage env strategy is necessary because Playwright's
 * `globalSetup` runs in PARALLEL with `webServer`, not before — so
 * environment values written there race the webServer's `next start`
 * env loader. Running this script outside Playwright sidesteps the
 * race entirely.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

const ENV_PATH = join(process.cwd(), '.env.local');

const ORIGINAL_ENV = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : null;

let container: StartedPostgreSqlContainer | undefined;

async function main() {
  // 1. Boot testcontainers Postgres + run migrations.
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('portal_e2e')
    .withUsername('test')
    .withPassword('test')
    .start();
  const url = container.getConnectionUri();

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
  } finally {
    await client.end();
  }

  // 2. Write the testcontainers URL into .env.local so Next picks it up.
  writeFileSync(
    ENV_PATH,
    `DATABASE_URL=${url}\n` +
      `NEXTAUTH_SECRET=e2e-secret-at-least-32-chars-long-xxxx\n` +
      `ENCRYPTION_KEY=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\n` +
      `CPF_HASH_PEPPER=e2e-pepper-at-least-32-chars-long-xxxxxx\n` +
      `E2E_TEST=1\n`,
    'utf8',
  );

  // 3. Run Playwright. Pass through any extra args (after `--`).
  const playwright_args = ['playwright', 'test', ...process.argv.slice(2)];
  const code = await new Promise<number>((resolve) => {
    const child = spawn('pnpm', playwright_args, {
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (c) => resolve(c ?? 1));
    child.on('error', () => resolve(1));
  });

  process.exitCode = code;
}

async function cleanup() {
  if (ORIGINAL_ENV !== null) {
    try {
      writeFileSync(ENV_PATH, ORIGINAL_ENV, 'utf8');
    } catch {
      /* ignore */
    }
  }
  if (container) {
    try {
      await container.stop();
    } catch {
      /* ignore */
    }
  }
}

process.on('SIGINT', () => {
  cleanup().finally(() => process.exit(130));
});

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[run-e2e]', err);
    process.exitCode = 1;
  })
  .finally(cleanup);
