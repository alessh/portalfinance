import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest 3.0.5 — projects are configured via the `workspace` field.
// Renamed to `projects` only in 3.2+. We pin 3.0.5 (Wave 0 plan) so we use
// the workspace API. Same semantics: each entry is an inline project config.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    setupFiles: ['tests/setup.ts'],
    workspace: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.{ts,tsx}'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // ----------------------------------------------------------------
          // Plan 02-09 — gap closure (Gap 2).
          // Pin to ONE forked worker running suites SEQUENTIALLY so the
          // singleton testcontainer in tests/fixtures/db.ts survives across
          // every suite. Default Vitest parallelism (~os.cpus().length forked
          // workers, file-level parallelism) blew past the 180s hookTimeout
          // on Windows + Docker Desktop / WSL2 (per-container two-stage init
          // ballooned from ~48s to >120s under contention). The trade is
          // longer wall time (typically 3-5 minutes for the full integration
          // suite) for deterministic pass/fail. CI runs see ~3 min; local
          // Windows + Docker Desktop sees ~5-8 min.
          // ----------------------------------------------------------------
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          // NOTE: `fileParallelism: false` belongs to vitest's NonProjectOptions
          // (config.d.ts line 2229) — it is REJECTED at the workspace[]-entry
          // level in vitest 3.0.5 with TS2769. We therefore rely entirely on
          // `pool: 'forks'` + `singleFork: true` to serialize files: a single
          // forked worker can only run one file at a time, so files run
          // sequentially within this project regardless of the global flag.
          //
          // `isolate: false` is REQUIRED for the singleton in
          // tests/fixtures/db.ts to actually be shared across suites. With
          // vitest's default `isolate: true`, the module graph is re-imported
          // between test files even inside a single forked worker — so the
          // module-level `_started` cache resets and every suite would still
          // boot its own container. Without this flag, the first dry-run of
          // plan 02-09 produced 20 leaked containers (one per suite) at
          // teardown despite singleFork, confirming module re-isolation. With
          // `isolate: false`, the singleton survives every suite in the run.
          isolate: false,
          // globalSetup boots the shared Postgres container once before any
          // suite runs and stops it after every suite completes. See
          // tests/fixtures/integration-globals.ts.
          globalSetup: ['tests/fixtures/integration-globals.ts'],
        },
      },
    ],
  },
});
