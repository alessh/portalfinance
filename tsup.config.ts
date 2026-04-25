/**
 * tsup build configuration for Portal Finance workers and migrations.
 *
 * Plan 01.1-02 / D-11 -- bundles the two node-only entrypoints shipped
 * into the Docker runner stage (D-09, D-12):
 *   - src/jobs/worker.ts -> dist/jobs/worker.js   (pg-boss consumer)
 *   - src/db/migrate.ts  -> dist/db/migrate.js    (Drizzle migrator)
 *
 * Rationale:
 *   - Removes `tsx` from the production runner image (~25 MB savings).
 *   - Target: node22 / CJS -- matches node:22-alpine runtime (D-12).
 *   - Native modules are externalised so alpine-compiled .node binaries
 *     (argon2, pg, pg-boss) resolve from node_modules at runtime.
 *
 * NOT bundled (resolve at runtime):
 *   - pg, pg-boss, argon2 (native bindings)
 *   - @aws-sdk/* (large, lazy-loaded by mailer)
 *   - next/* (defensive -- Drizzle schema barrel never imports next runtime)
 *
 * Related files:
 *   - Dockerfile builder stage runs `pnpm build:worker` after `pnpm build`.
 *   - package.json "build:worker" wired in Plan 01.1-01 Task 2.
 *   - package.json "db:migrate:prod" runs `node dist/db/migrate.js`.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'jobs/worker': 'src/jobs/worker.ts',
    'db/migrate': 'src/db/migrate.ts',
  },
  outDir: 'dist',
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  dts: false,
  external: [
    'pg',
    'pg-boss',
    'argon2',
    /^@aws-sdk\//,
    'next',
    /^next\//,
  ],
});
