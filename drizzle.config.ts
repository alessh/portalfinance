import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration for Portal Finance.
 *
 * - `dialect: 'postgresql'` — Postgres 16 in Railway sa-east-1.
 * - `schema` — single barrel file re-exports every table; one file per
 *   domain aggregate under src/db/schema/.
 * - `out` — migrations live in src/db/migrations/, committed to git.
 *
 * Use `pnpm db:generate` to author migrations from schema changes and
 * `pnpm db:migrate` to apply them. `drizzle-kit push` is BANNED in this
 * project per RESEARCH.md Pitfall — it rewrites schema without preserving
 * history and is unsafe once migrations are part of deploy state.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
