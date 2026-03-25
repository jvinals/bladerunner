import { test, expect } from '@playwright/test';

test.describe('AI / LLM save', () => {
  test('save fails when credential encryption is not configured', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'AI / LLM' }).click();
    await expect(page.getByRole('heading', { name: /Providers and credentials/i })).toBeVisible();
    await page.getByRole('button', { name: /Save LLM settings/i }).click();
    await expect(page.getByText(/LLM_CREDENTIALS_ENCRYPTION_KEY is not configured on the API server/i)).toBeVisible();
  });
});
