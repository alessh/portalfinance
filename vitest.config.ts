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
        },
      },
    ],
  },
});
