import { test, expect } from '@playwright/test';

test.describe('workspace tree flow', () => {
  test('opens Files Explorer and shows the directory explorer', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Files Explorer/i }).click();
    await expect(page.getByRole('heading', { name: /Target Directory Explorer/i })).toBeVisible();
  });
});
