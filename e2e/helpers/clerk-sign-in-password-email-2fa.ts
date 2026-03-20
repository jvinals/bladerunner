import type { Page } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { waitForClerkOtpFromAgentMail } from './agentmail-clerk-otp';

/**
 * Sign in through Clerk when the user has password + email (OTP) second factor.
 * Clerk may host the UI on accounts.* (cross-origin); Playwright follows that.
 */
export async function clerkSignInWithPasswordAndEmail2FA(
  page: Page,
  opts: { baseURL: string; identifier: string; password: string },
): Promise<void> {
  await setupClerkTestingToken({ page });

  await page.goto(`${opts.baseURL}/`);

  const idField = page.locator('input[name="identifier"], #identifier-field').first();
  await idField.waitFor({ state: 'visible', timeout: 60_000 });
  await idField.fill(opts.identifier);

  const passwordAlready = page.locator('input[name="password"][type="password"], input[type="password"]').first();
  const combined = await passwordAlready
    .isVisible()
    .catch(() => false);

  if (!combined) {
    await page.getByRole('button', { name: /continue/i }).first().click();
  }

  const passwordField = page.locator('input[name="password"][type="password"], input[type="password"]').first();
  await passwordField.waitFor({ state: 'visible', timeout: 60_000 });
  const notBeforeMs = Date.now() - 5_000;
  await passwordField.fill(opts.password);

  await page.getByRole('button', { name: /continue|sign in|log in/i }).first().click();

  const otpSingle = page
    .locator(
      'input[inputmode="numeric"], input[name="code"], input[autocomplete="one-time-code"], [data-input-otp]',
    )
    .first();

  try {
    await otpSingle.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    const anyOtp = page.locator('input[inputmode="numeric"]').first();
    await anyOtp.waitFor({ state: 'visible', timeout: 45_000 });
  }

  const otp = await waitForClerkOtpFromAgentMail({ notBeforeMs, timeoutMs: 120_000 });

  const multi = page.locator('input[inputmode="numeric"]');
  const count = await multi.count();
  if (count >= 6) {
    const digits = otp.split('');
    for (let i = 0; i < Math.min(digits.length, count); i++) {
      await multi.nth(i).fill(digits[i]!);
    }
  } else {
    await otpSingle.fill(otp);
  }

  await page.getByRole('button', { name: /continue|verify/i }).first().click();

  const host = new URL(opts.baseURL).hostname;
  await page.waitForURL(
    (url) => url.hostname === host || url.hostname === 'localhost',
    { timeout: 120_000 },
  );
}
