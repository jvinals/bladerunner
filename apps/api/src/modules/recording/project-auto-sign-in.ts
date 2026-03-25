import type { Page } from 'playwright-core';
import {
  clerkSignInUrlLooksLike,
  detectClerkOtpInputVisible,
  fillClerkOtpFromClerkTestEmail,
  fillClerkOtpFromMailSlurp,
  sleepMs,
  type ClerkOtpMode,
  MAILSLURP_POST_PASSWORD_DELAY_MS,
} from '@bladerunner/clerk-agentmail-signin';

export type AutoSignInAuthKind = 'clerk' | 'generic';

export type ProjectAutoSignInCredentials = {
  identifier: string;
  password: string;
  otpMode: ClerkOtpMode;
};

export async function pageHasClerkPublishableKey(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const w = window as Window & {
        Clerk?: { publishableKey?: string };
        __clerk_publishable_key?: string;
      };
      return Boolean(
        w.Clerk?.publishableKey ||
          w.__clerk_publishable_key ||
          document.querySelector('[data-clerk-publishable-key]'),
      );
    })
    .catch(() => false);
}

export async function detectLikelyClerkLoginPage(page: Page): Promise<boolean> {
  try {
    if (clerkSignInUrlLooksLike(page.url())) return true;
  } catch {
    /* ignore */
  }
  if (await pageHasClerkPublishableKey(page)) return true;
  return page
    .locator('input[name="identifier"], #identifier-field')
    .first()
    .isVisible()
    .catch(() => false);
}

function authEmailInput(page: Page) {
  return page
    .locator(
      [
        'input[type="email"]',
        'input[name="email"]',
        'input[autocomplete="email"]',
        'input[name*="email" i]',
      ].join(', '),
    )
    .first();
}

function authPasswordInput(page: Page) {
  return page
    .locator(
      [
        'input[name="password"][type="password"]',
        'input[type="password"]',
        'input[name*="password" i]',
      ].join(', '),
    )
    .first();
}

function authSubmitButton(page: Page) {
  return page
    .locator(
      [
        'form button[type="submit"]',
        'button[type="submit"]',
        'form input[type="submit"]',
      ].join(', '),
    )
    .first();
}

async function visibleAuthErrors(page: Page): Promise<string[]> {
  return (
    (await page
      .locator(
        [
          '[role="alert"]',
          '.error',
          '[data-error]',
          '[data-sonner-toast]',
        ].join(', '),
      )
      .evaluateAll((els) =>
        els
          .map((el) => (el.textContent || '').trim())
          .filter(Boolean)
          .slice(0, 6),
      )
      .catch(() => [])) as string[]
  );
}

export async function performProjectPasswordSignIn(
  page: Page,
  runUrl: string,
  creds: ProjectAutoSignInCredentials,
): Promise<void> {
  const emailField = authEmailInput(page);
  const passwordField = authPasswordInput(page);
  const otpVisibleBefore = await detectClerkOtpInputVisible(page);
  const emailVisible = await emailField.isVisible().catch(() => false);
  const passwordVisible = await passwordField.isVisible().catch(() => false);

  if (emailVisible && passwordVisible) {
    await emailField.fill(creds.identifier);
    await passwordField.fill(creds.password);
    const otpWindowStartMs = Date.now();
    const beforeSubmitUrl = page.url();
    await authSubmitButton(page).click();
    await Promise.race([
      page.waitForURL((url) => url.toString() !== beforeSubmitUrl, { timeout: 20_000 }).catch(() => {}),
      emailField.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {}),
      page
        .waitForFunction(
          () => {
            const sels = [
              'input[inputmode="numeric"]',
              'input[name="code"]',
              'input[autocomplete="one-time-code"]',
              '[data-input-otp]',
              'input[type="text"][inputmode="numeric"]',
            ];
            return sels.some((sel) => !!document.querySelector(sel));
          },
          { timeout: 20_000 },
        )
        .catch(() => {}),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    const otpVisibleAfter = await detectClerkOtpInputVisible(page);
    const emailStillVisible = await emailField.isVisible().catch(() => false);
    const passwordStillVisible = await passwordField.isVisible().catch(() => false);
    if (otpVisibleAfter && !emailStillVisible && !passwordStillVisible) {
      if (creds.otpMode === 'mailslurp') {
        await sleepMs(MAILSLURP_POST_PASSWORD_DELAY_MS);
        await fillClerkOtpFromMailSlurp(page, { runUrl, notBeforeMs: otpWindowStartMs });
      } else {
        await fillClerkOtpFromClerkTestEmail(page, { runUrl });
      }
      return;
    }
    if (emailStillVisible || passwordStillVisible) {
      const errs = await visibleAuthErrors(page);
      throw new Error(
        errs.length
          ? `Generic automatic sign-in stayed on the login form: ${errs.join(' | ')}`
          : 'Generic automatic sign-in stayed on the login form after submit',
      );
    }
    return;
  }

  if (otpVisibleBefore) {
    if (creds.otpMode === 'mailslurp') {
      await fillClerkOtpFromMailSlurp(page, { runUrl, notBeforeMs: Date.now() });
    } else {
      await fillClerkOtpFromClerkTestEmail(page, { runUrl });
    }
    return;
  }

  throw new Error('Generic automatic sign-in could not find an email/password or OTP form');
}
