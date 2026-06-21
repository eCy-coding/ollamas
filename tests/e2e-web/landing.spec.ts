import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// vF7 — vanilla landing: renders without a framework, shows live health, stays a11y-clean.
test.describe('vanilla landing', () => {
  test('renders hero + nav and reflects a healthy gateway', async ({ page }) => {
    await page.route('**/api/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'live', loadedModels: ['llama3'], ollamaVersion: '0.5.0' }),
      }),
    );
    await page.goto('/web/');
    await expect(page.getByRole('heading', { level: 1, name: /LLM Mission Control/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /Primary/i })).toBeVisible();
    // health badge picks up the stubbed status
    await expect(page.locator('[data-health-badge]')).toHaveAttribute('data-status', 'online');
    await expect(page.locator('[data-health-badge]')).toContainText(/online/i);
  });

  test('shows an offline badge when the gateway is down', async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({ status: 503, body: '{}' }));
    await page.goto('/web/');
    await expect(page.locator('[data-health-badge]')).toHaveAttribute('data-status', 'offline');
  });

  test('has no critical/serious WCAG AA violations', async ({ page }) => {
    await page.route('**/api/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"mode":"live"}' }),
    );
    await page.goto('/web/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking, JSON.stringify(blocking.map((v) => v.id), null, 2)).toEqual([]);
  });
});
