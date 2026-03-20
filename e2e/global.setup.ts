import fs from 'node:fs';
import path from 'node:path';
import { clerk, clerkSetup } from '@clerk/testing/playwright';
import { test as setup, expect } from '@playwright/test';
import { clerkSignInWithPasswordAndEmail2FA } from './helpers/clerk-sign-in-password-email-2fa';

setup.describe.configure({ mode: 'serial' });

const authDir = path.join(process.cwd(), 'playwright/.clerk');
const authFile = path.join(authDir, 'user.json');

setup('clerk testing token', async () => {
  await clerkSetup({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
});

setup('authenticate and save storage state', async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';
  const email = process.env.E2E_CLERK_USER_EMAIL;
  const password = process.env.E2E_CLERK_USER_PASSWORD;
  const identifier =
    process.env.E2E_CLERK_USER_USERNAME ?? process.env.E2E_CLERK_USER_EMAIL ?? '';

  if (!(password && identifier) && !email) {
    throw new Error(
      'E2E auth: set E2E_CLERK_USER_EMAIL (ticket sign-in), or email/username + E2E_CLERK_USER_PASSWORD; for email OTP add AGENTMAIL_API_KEY + E2E_AGENTMAIL_INBOX_ID. See README → E2E tests.',
    );
  }

  fs.mkdirSync(authDir, { recursive: true });

  const useAgentMail2Fa =
    !!process.env.AGENTMAIL_API_KEY &&
    !!(process.env.E2E_AGENTMAIL_INBOX_ID?.trim() || process.env.E2E_AGENTMAIL_INBOX_EMAIL?.trim()) &&
    !!password &&
    !!identifier;

  if (useAgentMail2Fa) {
    await clerkSignInWithPasswordAndEmail2FA(page, {
      baseURL,
      identifier,
      password,
    });
  } else {
    await page.goto(`${baseURL}/`);

    if (password && identifier) {
      await clerk.signIn({
        page,
        signInParams: {
          strategy: 'password',
          identifier,
          password,
        },
      });
    } else if (email) {
      await clerk.signIn({ page, emailAddress: email });
    } else {
      throw new Error('E2E auth: invalid credential combination.');
    }
  }

  // Home hits the dashboard API; /settings is static and works with only Vite + Clerk.
  await page.goto(`${baseURL}/settings`);
  await expect(page.getByRole('heading', { name: /Workspace Settings/i })).toBeVisible({
    timeout: 90_000,
  });

  await page.context().storageState({ path: authFile });
});
