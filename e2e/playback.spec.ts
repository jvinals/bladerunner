import { test, expect } from '@playwright/test';

/**
 * Mocks runs list + steps so Play is enabled, then forces playback/start to fail.
 * Asserts the live replay preview surfaces the error (no silent failure).
 */
test.describe('Runs live replay preview', () => {
  test('shows playback error in preview when start fails', async ({ page }) => {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (url.pathname === '/api/runs' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'run-e2e',
                name: 'E2E playback',
                url: 'https://example.com',
                status: 'COMPLETED',
                stepsCount: 1,
                createdAt: new Date().toISOString(),
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          }),
        });
        return;
      }

      if (url.pathname === '/api/runs/run-e2e/steps' && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'step-1',
              runId: 'run-e2e',
              sequence: 1,
              action: 'CLICK',
              instruction: 'tap',
              playwrightCode: 'await page.click("body")',
              origin: 'MANUAL',
              timestamp: new Date().toISOString(),
            },
          ]),
        });
        return;
      }

      if (url.pathname === '/api/runs/run-e2e/playback/start' && method === 'POST') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Playback unavailable (browser worker)' }),
        });
        return;
      }

      await route.continue();
    });

    await page.goto('/runs');

    await page.getByRole('combobox').first().selectOption('run-e2e');

    await expect(page.getByText('tap', { exact: false })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /^Play$/ }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert')).toContainText(/503|Playback|API Error|unavailable/i);
  });
});
