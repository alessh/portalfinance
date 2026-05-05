import { test, expect, type Page } from '@playwright/test';
import {
  closeSeedPg,
  findUserIdByEmail,
  seedAccount,
  seedPluggyItem,
  seedTransaction,
  setUserSubscriptionTier,
} from '../helpers/seedDb';

/**
 * /transactions visual regression smoke (Plan 02-17 Task 2, closes
 * 02-REVIEWS.md Concern #13).
 *
 * Three documented states from CONTEXT.md D-22..D-27:
 *   (a) empty   — no items connected → "Conecte seu primeiro banco"
 *   (b) loaded  — items + transactions visible
 *   (c) paywall — free tier picking a month older than 3-month window
 *
 * Auth: copies the canonical inline signup pattern from
 * tests/e2e/auth.spec.ts. No dedicated tests/e2e/helpers/auth.ts exists
 * as of 2026-05-05; the inline pattern is the project convention.
 *
 * DB seeding: uses tests/e2e/helpers/seedDb.ts to insert pluggy_items +
 * accounts + transactions directly into the testcontainers Postgres that
 * scripts/run-e2e.ts boots. Encryption keys are read from .env.local.
 */

async function signupFreshUser(page: Page): Promise<string> {
  const email = `playwright-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Correct-Horse-1234';
  await page.goto('/signup');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  // "Li e concordo" — Radix Checkbox label proxy (auth.spec.ts).
  await page.getByText('Li e concordo').click();
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  return email;
}

test.describe('/transactions screenshot smoke (Concern #13)', () => {
  test.afterAll(async () => {
    await closeSeedPg();
  });

  test('state empty — no items connected', async ({ page }) => {
    // Fresh user → no pluggy_items → /transactions empty state.
    await signupFreshUser(page);
    await page.goto('/transactions');
    await expect(
      page.getByText(/Conecte seu primeiro banco|Nenhum banco conectado/i),
    ).toBeVisible();
    await page.screenshot({
      path: 'test-results/screenshots/transactions-empty.png',
      fullPage: true,
    });
  });

  test('state loaded — items connected with transactions', async ({ page }) => {
    const email = await signupFreshUser(page);
    const user_id = await findUserIdByEmail(email);
    const item = await seedPluggyItem({
      user_id,
      status: 'UPDATED',
      institution_name: 'Sandbox Bank',
      last_synced_at: new Date(),
    });
    const account_id = await seedAccount({
      user_id,
      pluggy_item_id: item.id,
      name: 'Conta Corrente',
      type: 'BANK',
      balance: '5432.10',
    });
    const now = new Date();
    await seedTransaction({
      user_id,
      account_id,
      description: 'Mercado Pão',
      amount: '-87.45',
      type: 'DEBIT',
      posted_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
    });
    await seedTransaction({
      user_id,
      account_id,
      description: 'Salário',
      amount: '5500.00',
      type: 'CREDIT',
      posted_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    });
    await seedTransaction({
      user_id,
      account_id,
      description: 'Uber',
      amount: '-23.90',
      type: 'DEBIT',
      posted_at: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    });

    await page.goto('/transactions');
    await expect(
      page
        .locator('[data-testid=transaction-row], li[data-tx-id]')
        .first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: 'test-results/screenshots/transactions-loaded.png',
      fullPage: true,
    });
  });

  test('state paywall — free tier on older month', async ({ page }) => {
    const email = await signupFreshUser(page);
    const user_id = await findUserIdByEmail(email);
    // Default tier is 'paid' (Phase 5 will flip default to 'free'). Force
    // 'free' here so the paywall gate fires.
    await setUserSubscriptionTier(user_id, 'free');

    // Free-tier paywall fires when month < startOfMonth(now - 2 months).
    // Pick a month 6 months back — well past the cutoff.
    const today = new Date();
    const six_months_ago = new Date(today.getFullYear(), today.getMonth() - 6, 1);
    const month_param = `${six_months_ago.getFullYear()}-${String(six_months_ago.getMonth() + 1).padStart(2, '0')}`;

    await page.goto(`/transactions?month=${month_param}`);
    await expect(
      page.getByText(/Histórico completo|plano pago|Assinar/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    await page.screenshot({
      path: 'test-results/screenshots/transactions-paywall.png',
      fullPage: true,
    });
  });
});
