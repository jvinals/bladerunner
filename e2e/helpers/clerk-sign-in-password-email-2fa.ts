import type { Page } from '@playwright/test';
import { performClerkPasswordEmail2FA } from '@bladerunner/clerk-agentmail-signin';

/**
 * @deprecated Import `performClerkPasswordEmail2FA` from `@bladerunner/clerk-agentmail-signin` directly.
 * Kept as a thin alias for existing E2E imports.
 */
export async function clerkSignInWithPasswordAndEmail2FA(
  page: Page,
  opts: { baseURL: string; identifier: string; password: string },
): Promise<void> {
  await performClerkPasswordEmail2FA(page, {
    ...opts,
    skipInitialNavigate: false,
    /** E2E `.env` typically uses a real MailSlurp inbox, not `+clerk_test`. */
    otpMode: 'mailslurp',
  });
}
