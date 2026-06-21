import { expect, test } from '@playwright/test';

// vF6 — keyboard operability (WCAG 2.1.1). The cockpit must be fully usable
// without a mouse: tabs focusable, Enter/Space activate, focus advances on Tab.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/workspace/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tree: [], mode: 'demo', workspaceRoot: '/mock' }),
    }),
  );
});

test.describe('keyboard navigation', () => {
  test('tab bar is focusable and Enter activates a tab', async ({ page }) => {
    await page.goto('/');
    const saas = page.getByRole('button', { name: /SaaS Gateway/i });
    await saas.focus();
    await expect(saas).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByText(/SaaS Gateway Control/i)).toBeVisible();
  });

  test('Tab advances focus to a focusable control', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Cockpit Dashboard/i }).focus();
    await page.keyboard.press('Tab');
    const tag = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(tag).not.toBeNull();
    expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(tag);
  });
});
