/**
 * Canonical Clerk password + email OTP flow labels + safe no-op codegen for recording after
 * `performClerkPasswordEmail2FA` completes. Steps are skipped during playback when Clerk auto
 * is on (server runs one `performClerkPasswordEmail2FA`); stored Playwright is not relied on.
 */
export const CLERK_CANONICAL_SIGN_IN_STEPS: Array<{
  action: 'TYPE' | 'CLICK';
  instruction: string;
  playwrightCode: string;
}> = [
  {
    action: 'TYPE',
    instruction: 'Type the email address for sign-in',
    playwrightCode: `await page.waitForLoadState('domcontentloaded').catch(() => {});`,
  },
  {
    action: 'CLICK',
    instruction: 'Click Continue after entering the email',
    playwrightCode: `await page.waitForLoadState('domcontentloaded').catch(() => {});`,
  },
  {
    action: 'TYPE',
    instruction: 'Type the password',
    playwrightCode: `await page.waitForLoadState('domcontentloaded').catch(() => {});`,
  },
  {
    action: 'CLICK',
    instruction: 'Click Continue after entering the password',
    playwrightCode: `await page.waitForLoadState('domcontentloaded').catch(() => {});`,
  },
  {
    action: 'TYPE',
    instruction: 'Type the email verification code (from MailSlurp inbox when using MailSlurp OTP)',
    playwrightCode: `await page.waitForLoadState('domcontentloaded').catch(() => {});`,
  },
  {
    action: 'CLICK',
    instruction: 'Click Continue after entering the verification code',
    playwrightCode: `await page.waitForLoadState('domcontentloaded').catch(() => {});`,
  },
];
