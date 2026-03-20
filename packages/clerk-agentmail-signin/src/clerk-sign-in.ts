import type { Page } from 'playwright-core';
import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { waitForClerkOtpFromAgentMail } from './agentmail-otp';

/**
 * Playwright testing helpers expect `clerkSetup` to run first (sets `CLERK_FAPI` + `CLERK_TESTING_TOKEN`).
 * E2E global.setup does this; Nest API must do it per-process before any `setupClerkTestingToken`.
 */
async function ensureClerkTestingPlaywrightReady(): Promise<void> {
  if (process.env.CLERK_FAPI) {
    return;
  }

  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.VITE_CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!publishableKey || !secretKey) {
    throw new Error(
      'clerkSetup requires CLERK_PUBLISHABLE_KEY (or VITE_CLERK_PUBLISHABLE_KEY) and CLERK_SECRET_KEY so Clerk testing can set CLERK_FAPI.',
    );
  }

  await clerkSetup({
    publishableKey,
    secretKey,
    dotenv: false,
  });
}

/**
 * After entering the identifier, Clerk shows "Continue" — but OAuth rows often use
 * "Continue with Apple" which also matches /continue/i and must NOT be clicked.
 */
function locatorAfterIdentifierContinue(page: Page) {
  return page
    .getByRole('button', { name: /^Continue$/i })
    .or(page.getByRole('button', { name: /^Next$/i }));
}

/** Submit password step (avoid broad /continue/ that matches social buttons). */
function locatorAfterPasswordSubmit(page: Page) {
  return page
    .getByRole('button', { name: /^Sign in$/i })
    .or(page.getByRole('button', { name: /^Log in$/i }))
    .or(page.getByRole('button', { name: /^Continue$/i }));
}

function locatorAfterOtpSubmit(page: Page) {
  return page
    .getByRole('button', { name: /^Continue$/i })
    .or(page.getByRole('button', { name: /^Verify$/i }));
}

/** Hosted Clerk / common dev patterns */
const CLERK_HOST_SUBSTR = ['clerk.', 'accounts.'];

export function clerkSignInUrlLooksLike(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (CLERK_HOST_SUBSTR.some((s) => h.includes(s))) return true;
    const path = `${u.pathname}${u.search}`.toLowerCase();
    return (
      path.includes('/sign-in') ||
      path.includes('/signin') ||
      path.includes('sign_in') ||
      path.includes('/login')
    );
  } catch {
    return /sign-in|signin|clerk|accounts\./i.test(url);
  }
}

/**
 * True when the page likely shows Clerk identifier/password or OTP UI.
 */
export async function detectClerkSignInUi(page: Page): Promise<boolean> {
  try {
    if (clerkSignInUrlLooksLike(page.url())) return true;
  } catch {
    /* ignore */
  }

  const identifier = page.locator('input[name="identifier"], #identifier-field').first();
  const idVisible = await identifier.isVisible().catch(() => false);
  if (idVisible) return true;

  const pwd = page
    .locator('input[name="password"][type="password"]')
    .or(page.locator('input[type="password"]'))
    .first();
  const pwdVisible = await pwd.isVisible().catch(() => false);
  if (pwdVisible) {
    const otp = page.locator('input[inputmode="numeric"], input[name="code"]').first();
    const otpVisible = await otp.isVisible().catch(() => false);
    if (!otpVisible) return true;
  }

  const otpOnly = page
    .locator(
      'input[inputmode="numeric"], input[name="code"], input[autocomplete="one-time-code"], [data-input-otp]',
    )
    .first();
  return otpOnly.isVisible().catch(() => false);
}

export type PerformClerkPasswordEmail2FAOpts = {
  baseURL: string;
  identifier: string;
  password: string;
  /** When true, do not navigate — already on sign-in (e.g. playback after recorded goto). */
  skipInitialNavigate?: boolean;
};

/**
 * Sign in through Clerk when the user has password + email (OTP) second factor.
 * Clerk may host the UI on accounts.* (cross-origin); Playwright follows that.
 */
export async function performClerkPasswordEmail2FA(
  page: Page,
  opts: PerformClerkPasswordEmail2FAOpts,
): Promise<void> {
  await ensureClerkTestingPlaywrightReady();
  await setupClerkTestingToken({ page });

  const base = opts.baseURL.replace(/\/$/, '');
  if (!opts.skipInitialNavigate) {
    await page.goto(`${base}/`);
  }

  const idField = page.locator('input[name="identifier"], #identifier-field').first();
  await idField.waitFor({ state: 'visible', timeout: 60_000 });
  await idField.fill(opts.identifier);

  const passwordAlready = page
    .locator('input[name="password"][type="password"], input[type="password"]')
    .first();
  const combined = await passwordAlready.isVisible().catch(() => false);

  if (!combined) {
    await locatorAfterIdentifierContinue(page).first().click();
  }

  const passwordField = page
    .locator('input[name="password"][type="password"], input[type="password"]')
    .first();
  await passwordField.waitFor({ state: 'visible', timeout: 60_000 });
  const notBeforeMs = Date.now() - 5_000;
  await passwordField.fill(opts.password);

  await locatorAfterPasswordSubmit(page).first().click();

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

  await locatorAfterOtpSubmit(page).first().click();

  const host = new URL(opts.baseURL.includes('://') ? opts.baseURL : `https://${opts.baseURL}`).hostname;
  await page.waitForURL(
    (url) => url.hostname === host || url.hostname === 'localhost' || url.hostname === '127.0.0.1',
    { timeout: 120_000 },
  );
}
