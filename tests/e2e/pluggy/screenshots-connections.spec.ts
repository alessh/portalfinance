import { test, expect, type Page } from '@playwright/test';
import {
  closeSeedPg,
  findUserIdByEmail,
  seedAccount,
  seedPluggyItem,
  setUserSubscriptionTier,
} from '../helpers/seedDb';

/**
 * /settings/connections visual regression smoke (Plan 02-17 Task 2,
 * closes 02-REVIEWS.md Concern #13).
 *
 * Three documented states:
 *   (a) healthy  — at least one pluggy_items row with status='UPDATED'
 *   (b) broken   — at least one pluggy_items row with status='LOGIN_ERROR'
 *   (c) cooldown — paid user with last_manual_sync_at within 30 minutes
 *                  → manual sync button disabled with "Aguarde N min"
 *
 * Auth: identical inline signup pattern to screenshots-transactions.spec.ts
 * (no shared helper exists yet — see tests/e2e/auth.spec.ts).
 *
 * DB seeding: tests/e2e/helpers/seedDb.ts inserts pluggy_items + accounts
 * directly into the testcontainers Postgres. Cooldown anchor is
 * last_manual_sync_at, NOT last_synced_at (plan 02-18 Concern #12).
 */

async function signupFreshUser(page: Page): Promise<string> {
  const email = `playwright-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Correct-Horse-1234';
  await page.goto('/signup');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  await page.getByText('Li e concordo').click();
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  return email;
}

test.describe('/settings/connections screenshot smoke (Concern #13)', () => {
  test.afterAll(async () => {
    await closeSeedPg();
  });

  test('state healthy — all items UPDATED', async ({ page }) => {
    const email = await signupFreshUser(page);
    const user_id = await findUserIdByEmail(email);
    const item = await seedPluggyItem({
      user_id,
      status: 'UPDATED',
      institution_name: 'Sandbox Bank',
      last_synced_at: new Date(),
    });
    await seedAccount({
      user_id,
      pluggy_item_id: item.id,
      name: 'Conta Corrente',
      type: 'BANK',
      balance: '5432.10',
    });

    await page.goto('/settings/connections');
    await expect(
      page.getByText(/Conectado|Atualizado|Sandbox Bank/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: 'test-results/screenshots/connections-healthy.png',
      fullPage: true,
    });
  });

  test('state broken — LOGIN_ERROR item', async ({ page }) => {
    const email = await signupFreshUser(page);
    const user_id = await findUserIdByEmail(email);
    const item = await seedPluggyItem({
      user_id,
      status: 'LOGIN_ERROR',
      institution_name: 'Sandbox Bank',
      last_synced_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await seedAccount({
      user_id,
      pluggy_item_id: item.id,
      name: 'Conta Corrente',
      type: 'BANK',
      balance: '1000.00',
    });

    await page.goto('/settings/connections');
    await expect(
      page.getByText(/Reconectar|expirou|erro de login/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: 'test-results/screenshots/connections-broken.png',
      fullPage: true,
    });
  });

  test('state cooldown — manual sync recently triggered', async ({ page }) => {
    const email = await signupFreshUser(page);
    const user_id = await findUserIdByEmail(email);
    // Cooldown gate is gated to paid tier (free tier has the manual-sync
    // button hidden behind the paywall stub).
    await setUserSubscriptionTier(user_id, 'paid');
    const recent_manual = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const item = await seedPluggyItem({
      user_id,
      status: 'UPDATED',
      institution_name: 'Sandbox Bank',
      last_synced_at: recent_manual,
      last_manual_sync_at: recent_manual,
    });
    await seedAccount({
      user_id,
      pluggy_item_id: item.id,
      name: 'Conta Corrente',
      type: 'BANK',
      balance: '5432.10',
    });

    await page.goto('/settings/connections');
    // The manual-sync button should be disabled with a countdown label.
    const sync_btn = page
      .locator('button:has-text("Sincronizar agora"), button:has-text("Aguarde")')
      .first();
    await expect(sync_btn).toBeDisabled({ timeout: 10_000 });
    await page.screenshot({
      path: 'test-results/screenshots/connections-cooldown.png',
      fullPage: true,
    });
  });
});
