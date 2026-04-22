import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  // E2E env setup lives in scripts/run-e2e.ts (the `pnpm test:e2e`
  // wrapper) — not in Playwright globalSetup, because Playwright
  // launches `webServer` in PARALLEL with globalSetup.
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // globalSetup mutates process.env with the testcontainers URL +
    // safe-default secrets. Playwright launches `webServer` AFTER
    // globalSetup runs, so the spawned `next start` inherits them.
    command: 'pnpm start:web',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
