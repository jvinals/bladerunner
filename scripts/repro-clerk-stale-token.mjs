/**
 * Simulates a long-lived API process: valid CLERK_FAPI but a stale CLERK_TESTING_TOKEN.
 * `performClerkPasswordEmail2FA` must call `clerkSetup` every time or Clerk FAPI returns 403.
 *
 * Usage (from repo root):
 *   pnpm exec playwright install chromium   # once
 *   node --env-file=.env scripts/repro-clerk-stale-token.mjs https://your-app.example
 *
 * Requires the same env as E2E password + email OTP (see README).
 */
import { performClerkPasswordEmail2FA } from '@bladerunner/clerk-agentmail-signin';
import { clerkSetup } from '@clerk/testing/playwright';
import { chromium } from 'playwright';

const argvRest = process.argv.slice(2).filter((a) => a !== '--');
const baseURL = argvRest[0]?.trim() || process.env.REPRO_CLERK_BASE_URL?.trim();
const identifier =
  process.env.E2E_CLERK_USER_USERNAME?.trim() || process.env.E2E_CLERK_USER_EMAIL?.trim();
const password = process.env.E2E_CLERK_USER_PASSWORD?.trim();
const publishableKey =
  process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
  process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
const secretKey =
  process.env.PLAYBACK_CLERK_SECRET_KEY?.trim() ||
  process.env.E2E_CLERK_SECRET_KEY?.trim() ||
  process.env.CLERK_SECRET_KEY?.trim();

if (!baseURL || !identifier || !password || !publishableKey || !secretKey) {
  console.error(
    'Missing env or args. Pass app origin as argv[1] or REPRO_CLERK_BASE_URL. Need E2E_CLERK_USER_EMAIL (or USERNAME), E2E_CLERK_USER_PASSWORD, CLERK_SECRET_KEY (or PLAYBACK_CLERK_SECRET_KEY / E2E_CLERK_SECRET_KEY), CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY, AGENTMAIL + inbox (see README).',
  );
  process.exit(1);
}

await clerkSetup({
  publishableKey,
  secretKey,
  dotenv: false,
});

if (!process.env.CLERK_FAPI) {
  console.error('clerkSetup did not set CLERK_FAPI');
  process.exit(1);
}

process.env.CLERK_TESTING_TOKEN = 'stale-invalid-token-on-purpose';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await performClerkPasswordEmail2FA(page, { baseURL, identifier, password });
  console.log('OK: sign-in completed (stale token was refreshed inside performClerkPasswordEmail2FA)');
  process.exit(0);
} catch (e) {
  console.error('FAIL:', e);
  process.exit(1);
} finally {
  await browser.close();
}
