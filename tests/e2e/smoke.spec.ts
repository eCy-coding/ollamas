import { test, expect } from '@playwright/test';

test.describe('app shell smoke', () => {
  test('boots and renders the tab navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Cockpit Dashboard/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /SaaS Gateway/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /ReAct Specialist/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Files Explorer/i })).toBeVisible();
  });
});
