import { test, expect } from '@playwright/test';

test('homepage renders with pt-BR locale', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
});
