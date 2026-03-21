/**
 * Legacy (pre–single-step `clerk_auto_sign_in`): six synthetic rows some older runs still have
 * (`metadata.clerkAutomationCanonical`). New recordings persist one `CUSTOM` step instead.
 * Playback still filters these out of the execution chain when auto Clerk is on.
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
