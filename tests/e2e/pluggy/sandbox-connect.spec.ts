import { test, expect } from '@playwright/test';

/**
 * Real-Pluggy-sandbox e2e gate (Plan 02-17, closes 02-REVIEWS.md Concern #2).
 *
 * Roadmap success criterion #1 says "user opens /connect, completes Pluggy
 * sandbox bank, sees accounts and transactions on /transactions within 60
 * seconds." The mocked E2E suite (Plan 02-06) proves UI navigation only;
 * this spec proves the real Pluggy sandbox + worker round-trip meets the
 * 60s budget.
 *
 * GATING: skipped unless PLUGGY_SANDBOX_CLIENT_ID + PLUGGY_SANDBOX_CLIENT_SECRET
 * are set. Run locally with:
 *   PLUGGY_SANDBOX_CLIENT_ID=... PLUGGY_SANDBOX_CLIENT_SECRET=... \
 *     pnpm test:e2e -- pluggy/sandbox-connect.spec.ts
 *
 * The repo deliberately does NOT ship a GitHub Actions workflow yet — deploys
 * are still manual. When CI is re-enabled, wire this spec into a nightly job
 * per docs/ops/pluggy-sandbox-gate.md.
 *
 * Sandbox semantics (D-48):
 *   - CPF for OF basic flow: 761.092.776-73
 *   - Username variations: user-ok → SUCCESS, user-locked → ACCOUNT_LOCKED, etc.
 *   - Password: password-ok or 123456
 *   - Sandbox items expire after 30 days; the spec creates a fresh item each run.
 */

test.describe('Pluggy sandbox real connect (success criterion #1 hard gate)', () => {
  test.skip(
    !process.env.PLUGGY_SANDBOX_CLIENT_ID || !process.env.PLUGGY_SANDBOX_CLIENT_SECRET,
    'PLUGGY_SANDBOX_CLIENT_ID/SECRET not set — skipping real-sandbox gate; supply both env vars to run.',
  );

  test('connect → /transactions shows >=1 transaction within 60 seconds (real sandbox)', async ({
    page,
  }) => {
    // 1. Sign up + auto sign-in (canonical pattern from tests/e2e/auth.spec.ts).
    const test_email = `e2e+sandbox+${Date.now()}@portalfinance.app`;
    const test_password = 'Correct-Horse-1234';
    await page.goto('/signup');
    await page.fill('input[name="email"]', test_email);
    await page.fill('input[name="password"]', test_password);
    await page.fill('input[name="confirmPassword"]', test_password);
    // Radix Checkbox renders the input as aria-hidden behind a visible
    // proxy. Click the label text instead.
    await page.getByText('Li e concordo').click();
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 30_000 });

    // 2. Navigate to /connect.
    await page.goto('/connect');
    await page.waitForLoadState('networkidle');

    // 3. CPF entry on the consent screen — sandbox CPF per D-48.
    const cpf_input = page.locator('input[name="cpf"]');
    if (await cpf_input.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await cpf_input.fill('761.092.776-73');
      const cpf_submit = page.locator('button[type="submit"]');
      await cpf_submit.click();
      await page.waitForLoadState('networkidle');
    }

    // 4. Consent checkbox.
    const consent_checkbox = page.locator('[data-testid="pluggy-consent-checkbox"]');
    if (await consent_checkbox.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await consent_checkbox.click();
    } else {
      const consent_alt = page.getByRole('checkbox');
      if (await consent_alt.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await consent_alt.click();
      }
    }

    // 5. Submit — opens the Pluggy widget iframe with a real sandbox token.
    const connect_btn = page
      .getByRole('button', { name: /Concordar e conectar|Conectar/i })
      .first();
    await connect_btn.click();

    // 6. Inside the Pluggy widget iframe: pick a sandbox bank, enter
    //    user-ok / password-ok. Selectors mirror the Pluggy widget DOM
    //    as of 2026-05; if Pluggy changes the widget structure, update
    //    these selectors and bump the comment.
    const widget_frame = page.frameLocator(
      'iframe[title*="Pluggy" i], iframe[src*="pluggy"]',
    );
    await widget_frame
      .locator('text=Pluggy Bank')
      .first()
      .click({ timeout: 30_000 });
    await widget_frame.locator('input[name=user]').fill('user-ok');
    await widget_frame.locator('input[type=password]').fill('password-ok');
    await widget_frame
      .locator('button:has-text("Continue"), button:has-text("Continuar")')
      .first()
      .click();

    // 7. Widget onSuccess → /connect/success → poll → /transactions.
    //    Start the 60s timer at this point.
    const t_widget_done = Date.now();
    await expect(page).toHaveURL(/\/transactions/, { timeout: 65_000 });

    // 8. Assert at least 1 transaction visible. Selector mirrors UI-SPEC § 3.5.
    const tx_rows = page.locator('[data-testid=transaction-row], li[data-tx-id]');
    await expect(tx_rows.first()).toBeVisible({
      timeout: Math.max(1_000, 60_000 - (Date.now() - t_widget_done)),
    });

    const observed_latency_ms = Date.now() - t_widget_done;
    const tx_count = await tx_rows.count();

    // Forensic — surface to stdout so the harness logs capture the gate's metrics.
    // eslint-disable-next-line no-console
    console.log(
      `[sandbox-connect] observed_latency_ms=${observed_latency_ms} tx_count=${tx_count}`,
    );

    expect(
      observed_latency_ms,
      `connect → first transaction visible took ${observed_latency_ms}ms; criterion #1 = 60000ms`,
    ).toBeLessThan(60_000);
    expect(tx_count).toBeGreaterThanOrEqual(1);
  });
});
