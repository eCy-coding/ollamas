import { test, expect } from '@playwright/test';

test.describe('SaaS admin flow', () => {
  test('opens SaaS Gateway and shows the control panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /SaaS Gateway/i }).click();
    await expect(page.getByText(/SaaS Gateway Control/i)).toBeVisible();
  });
});
