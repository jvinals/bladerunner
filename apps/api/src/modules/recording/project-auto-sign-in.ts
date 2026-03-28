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
  const hasPublishableKey = await pageHasClerkPublishableKey(page);
  const identifierVisible = await page
    .locator('input[name="identifier"], #identifier-field')
    .first()
    .isVisible()
    .catch(() => false);
  return hasPublishableKey || identifierVisible;
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
        'form button[type="submit"]:visible',
        'button[type="submit"]:visible',
        'form input[type="submit"]:visible',
      ].join(', '),
    )
    .first();
}

const GENERIC_OTP_SELECTORS = [
  'input[inputmode="numeric"]',
  'input[name="code"]',
  'input[autocomplete="one-time-code"]',
  '[data-input-otp]',
  'input[type="text"][inputmode="numeric"]',
].join(', ');

type ProjectAuthState = {
  otpVisible: boolean;
  emailVisible: boolean;
  passwordVisible: boolean;
  visibleControls: Array<{
    tag: string;
    type: string;
    name: string;
    autocomplete: string;
    inputmode: string;
    placeholder: string;
    text: string;
  }>;
};

async function debugVisibleAuthControls(page: Page): Promise<
  Array<{
    tag: string;
    type: string;
    name: string;
    autocomplete: string;
    inputmode: string;
    placeholder: string;
    text: string;
  }>
> {
  return page
    .evaluate(() => {
      const isVisible = (el: Element) => {
        const html = el as HTMLElement;
        const style = window.getComputedStyle(html);
        const rect = html.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      return Array.from(document.querySelectorAll('input, button'))
        .filter((el) => isVisible(el))
        .slice(0, 8)
        .map((el) => {
          const html = el as HTMLElement;
          return {
            tag: el.tagName.toLowerCase(),
            type: (el.getAttribute('type') || '').trim(),
            name: (el.getAttribute('name') || '').trim(),
            autocomplete: (el.getAttribute('autocomplete') || '').trim(),
            inputmode: (el.getAttribute('inputmode') || '').trim(),
            placeholder: (el.getAttribute('placeholder') || '').trim(),
            text: (html.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          };
        });
    })
    .catch(() => []);
}

async function readProjectAuthState(page: Page): Promise<ProjectAuthState> {
  const [otpVisible, emailVisible, passwordVisible, visibleControls] = await Promise.all([
    detectClerkOtpInputVisible(page),
    authEmailInput(page).isVisible().catch(() => false),
    authPasswordInput(page).isVisible().catch(() => false),
    debugVisibleAuthControls(page),
  ]);
  return { otpVisible, emailVisible, passwordVisible, visibleControls };
}

async function waitForGenericAuthUi(page: Page, timeoutMs: number): Promise<void> {
  await Promise.race([
    authEmailInput(page).waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {}),
    authPasswordInput(page).waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {}),
    page
      .waitForFunction(
        (selectors) => selectors.some((sel) => !!document.querySelector(sel)),
        GENERIC_OTP_SELECTORS.split(', '),
        { timeout: timeoutMs },
      )
      .catch(() => {}),
  ]);
}

async function waitForGenericAuthTransition(page: Page, beforeUrl: string, timeoutMs: number): Promise<void> {
  await Promise.race([
    page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: timeoutMs }).catch(() => {}),
    authPasswordInput(page).waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {}),
    page
      .waitForFunction(
        (selectors) => selectors.some((sel) => !!document.querySelector(sel)),
        GENERIC_OTP_SELECTORS.split(', '),
        { timeout: timeoutMs },
      )
      .catch(() => {}),
  ]);
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
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
  let state = await readProjectAuthState(page);

  if (!state.emailVisible && !state.passwordVisible && !state.otpVisible) {
    await waitForGenericAuthUi(page, 15_000);
    state = await readProjectAuthState(page);
  }

  if (state.emailVisible && !state.passwordVisible) {
    await emailField.fill(creds.identifier);
    const beforeSubmitUrl = page.url();
    await authSubmitButton(page).click();
    await waitForGenericAuthTransition(page, beforeSubmitUrl, 20_000);
    state = await readProjectAuthState(page);
  }

  if (state.emailVisible && state.passwordVisible) {
    await emailField.fill(creds.identifier);
  }

  if (state.passwordVisible) {
    await passwordField.fill(creds.password);
    const otpWindowStartMs = Date.now();
    const beforeSubmitUrl = page.url();
    await authSubmitButton(page).click();
    await waitForGenericAuthTransition(page, beforeSubmitUrl, 20_000);
    state = await readProjectAuthState(page);
    if (state.otpVisible && !state.emailVisible && !state.passwordVisible) {
      if (creds.otpMode === 'mailslurp') {
        await sleepMs(MAILSLURP_POST_PASSWORD_DELAY_MS);
        await fillClerkOtpFromMailSlurp(page, { runUrl, notBeforeMs: otpWindowStartMs });
      } else {
        await fillClerkOtpFromClerkTestEmail(page, { runUrl });
      }
      return;
    }
    if (state.emailVisible || state.passwordVisible) {
      const immediateUrl = page.url();
      const immediateState = state;
      const probeStartedAt = Date.now();
      await Promise.race([
        page.waitForURL((url) => url.toString() !== immediateUrl, { timeout: 4000 }).catch(() => {}),
        page
          .waitForFunction(
            () => {
              const selectors = [
                'input[type="email"]',
                'input[name="email"]',
                'input[autocomplete="email"]',
                'input[name*="email" i]',
                'input[name="password"][type="password"]',
                'input[type="password"]',
                'input[name*="password" i]',
              ];
              const isVisible = (el: Element | null) => {
                if (!el) return false;
                const html = el as HTMLElement;
                const style = window.getComputedStyle(html);
                const rect = html.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
              };
              return selectors.every((selector) => !Array.from(document.querySelectorAll(selector)).some((el) => isVisible(el)));
            },
            { timeout: 4000 },
          )
          .catch(() => {}),
      ]);
      state = await readProjectAuthState(page);
      if (state.otpVisible && !state.emailVisible && !state.passwordVisible) {
        if (creds.otpMode === 'mailslurp') {
          await sleepMs(MAILSLURP_POST_PASSWORD_DELAY_MS);
          await fillClerkOtpFromMailSlurp(page, { runUrl, notBeforeMs: otpWindowStartMs });
        } else {
          await fillClerkOtpFromClerkTestEmail(page, { runUrl });
        }
        return;
      }
      if (!state.emailVisible && !state.passwordVisible) {
        return;
      }
      const errs = await visibleAuthErrors(page);
      throw new Error(
        errs.length
          ? `Generic automatic sign-in stayed on the login form: ${errs.join(' | ')}`
          : 'Generic automatic sign-in stayed on the login form after submit',
      );
    }
    return;
  }

  if (state.otpVisible) {
    if (creds.otpMode === 'mailslurp') {
      await fillClerkOtpFromMailSlurp(page, { runUrl, notBeforeMs: Date.now() });
    } else {
      await fillClerkOtpFromClerkTestEmail(page, { runUrl });
    }
    return;
  }

  throw new Error('Generic automatic sign-in could not find an email/password or OTP form');
}
