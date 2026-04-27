import fs from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

/**
 * Production-safe migration runner.
 *
 * Invoked by `pnpm db:migrate` (Railway predeploy hook on the web service).
 *
 * Steps:
 * 1. CREATE EXTENSION IF NOT EXISTS pgcrypto — required for
 *    `gen_random_uuid()` (RESEARCH.md Landmine for 01-01). Idempotent.
 * 2. Apply pending Drizzle migrations from src/db/migrations/. Drizzle
 *    tracks applied migrations in the `drizzle.__migrations` table; running
 *    twice is a no-op.
 *
 * `drizzle-kit push` is BANNED. Only `generate` + `migrate` are used.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for migration');
  }

  // See src/db/index.ts -- postgres-js does not honor libpq sslrootcert.
  const ca_path = '/app/rds-ca-bundle.pem';
  const ssl_opts = fs.existsSync(ca_path)
    ? { ca: fs.readFileSync(ca_path, 'utf8'), rejectUnauthorized: true as const }
    : undefined;

  const client = postgres(url, { max: 1, ssl: ssl_opts });
  const db = drizzle(client);

  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log('migrations applied');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
