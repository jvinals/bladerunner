import { test, expect } from '@playwright/test';

test.describe('signed-in app shell', () => {
  test('settings page shows workspace heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /Workspace Settings/i })).toBeVisible();
  });

  test('sidebar navigation includes Runs', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: 'Runs' })).toBeVisible();
  });
});
