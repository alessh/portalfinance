import { test, expect } from '@playwright/test';

/**
 * Phase 1 plan 01-02 e2e flow per VALIDATION.md task `1-02-XX auth.spec.ts`.
 *
 * Register → automatic sign-in via the signup action → session persists
 * across reload → logout invalidates the cookie → /dashboard redirects
 * back to /login.
 */
test('register → login → session persists across reload → logout', async ({
  page,
}) => {
  const email = `playwright-${Date.now()}@example.com`;
  const password = 'Correct-Horse-1234';

  await page.goto('/signup');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  // Radix Checkbox renders the input as aria-hidden behind a visible
  // proxy. Click the label text instead — same effect, accessibility-
  // visible target.
  await page.getByText('Li e concordo').click();
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 30_000 });

  // Reload — session persists.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);

  // Logout via dashboard control.
  await page.click('[data-testid="logout"]');
  await page.waitForURL('**/login', { timeout: 30_000 });

  // Hitting /dashboard while logged out redirects to /login.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
