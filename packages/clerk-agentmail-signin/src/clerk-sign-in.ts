import type { BrowserContext, Page, Response } from 'playwright-core';
import { clerkSetup } from '@clerk/testing/playwright';
import { waitForClerkOtpFromAgentMail } from './agentmail-otp';

/** Same query param as `@clerk/testing` Playwright route (see `@clerk/testing` chunk-M5YIJ3SE). */
const CLERK_TESTING_TOKEN_PARAM = '__clerk_testing_token';

/**
 * One dynamic route per context: matches `https://${CLERK_FAPI}/v1/*` using **current** env on each request,
 * so `clerkSetup` can switch FAPI (e.g. after reading the **target app’s** publishable key) without stacking
 * incompatible `RegExp` handlers from `setupClerkTestingToken`.
 */
const contextsWithDynamicClerkFapiRoute = new WeakSet<BrowserContext>();

function envPublishableKey(): string | undefined {
  const k =
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.VITE_CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return k?.trim() || undefined;
}

async function readPublishableKeyFromPage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as Window & {
      Clerk?: { publishableKey?: string };
      __clerk_publishable_key?: string;
    };
    const fromClerk = w.Clerk?.publishableKey;
    if (fromClerk && typeof fromClerk === 'string' && fromClerk.startsWith('pk_')) return fromClerk;
    if (typeof w.__clerk_publishable_key === 'string' && w.__clerk_publishable_key.startsWith('pk_')) {
      return w.__clerk_publishable_key;
    }
    const el = document.querySelector('[data-clerk-publishable-key]');
    const attr = el?.getAttribute('data-clerk-publishable-key');
    if (attr && attr.startsWith('pk_')) return attr;
    return null;
  });
}

async function waitForClerkOrSignInUi(page: Page, timeoutMs: number): Promise<void> {
  const id = page.locator('input[name="identifier"], #identifier-field').first();
  await Promise.race([
    page
      .waitForFunction(
        () => {
          const Cl = (window as Window & { Clerk?: { publishableKey?: string } }).Clerk;
          return Boolean(Cl?.publishableKey);
        },
        { timeout: timeoutMs },
      )
      .catch(() => {}),
    id.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {}),
  ]);
}

async function installDynamicClerkFapiRouteOnce(context: BrowserContext): Promise<void> {
  if (contextsWithDynamicClerkFapiRoute.has(context)) return;
  contextsWithDynamicClerkFapiRoute.add(context);
  // #region agent log
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
    body: JSON.stringify({
      sessionId: '5f6bd9',
      hypothesisId: 'H2',
      location: 'clerk-sign-in.ts:installDynamicClerkFapiRouteOnce',
      message: 'registered dynamic CLERK_FAPI /v1 route (reads env per request)',
      data: { firstInstall: true },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  await context.route(
    (url) => {
      const fapi = process.env.CLERK_FAPI;
      if (!fapi) return false;
      return url.protocol === 'https:' && url.hostname === fapi && url.pathname.startsWith('/v1/');
    },
    async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const token = process.env.CLERK_TESTING_TOKEN;
      if (token) {
        u.searchParams.set(CLERK_TESTING_TOKEN_PARAM, token);
      }
      try {
        const response = await route.fetch({ url: u.toString() });
        const json: unknown = await response.json();
        if (json && typeof json === 'object') {
          const o = json as {
            response?: { captcha_bypass?: boolean };
            client?: { captcha_bypass?: boolean };
          };
          if (o.response && typeof o.response === 'object' && o.response.captcha_bypass === false) {
            o.response.captcha_bypass = true;
          }
          if (o.client && typeof o.client === 'object' && o.client.captcha_bypass === false) {
            o.client.captcha_bypass = true;
          }
        }
        await route.fulfill({ response, json });
      } catch {
        await route.continue({ url: u.toString() }).catch(() => {});
      }
    },
  );
}

function attachClerkFapi403DebugLogger(page: Page): () => void {
  const handler = (res: Response) => {
    const url = res.url();
    if (res.status() !== 403 || !url.includes('/v1/')) return;
    const fapi = process.env.CLERK_FAPI;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* ignore */
    }
    // #region agent log
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
      body: JSON.stringify({
        sessionId: '5f6bd9',
        hypothesisId: 'H5',
        location: 'clerk-sign-in.ts:response',
        message: 'Clerk FAPI 403 response',
        data: { responseHost: host, configuredFapi: fapi ?? '', hostMatchesFapi: !!(fapi && host === fapi) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  };
  page.on('response', handler);
  return () => page.off('response', handler);
}

/**
 * Refresh `CLERK_FAPI` + `CLERK_TESTING_TOKEN` for the given publishable key (always clears stale token first).
 */
async function refreshClerkTestingCredentials(publishableKey: string): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      'clerkSetup requires CLERK_SECRET_KEY so Clerk testing can mint CLERK_TESTING_TOKEN.',
    );
  }

  const env = process.env as Record<string, string | undefined>;
  const hadFapi = Boolean(env.CLERK_FAPI);
  const hadToken = Boolean(env.CLERK_TESTING_TOKEN);
  const tokenLenBefore = env.CLERK_TESTING_TOKEN?.length ?? 0;
  // #region agent log
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
    body: JSON.stringify({
      sessionId: '5f6bd9',
      hypothesisId: 'H1',
      location: 'clerk-sign-in.ts:refreshClerkTestingCredentials',
      message: 'before clerkSetup (refresh testing token)',
      data: { hadFapi, hadToken, tokenLenBefore },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  delete process.env.CLERK_TESTING_TOKEN;
  await clerkSetup({
    publishableKey,
    secretKey,
    dotenv: false,
  });

  const tokenLenAfter = env.CLERK_TESTING_TOKEN?.length ?? 0;
  const fapiLen = env.CLERK_FAPI?.length ?? 0;
  // #region agent log
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
    body: JSON.stringify({
      sessionId: '5f6bd9',
      hypothesisId: 'H1',
      location: 'clerk-sign-in.ts:refreshClerkTestingCredentials',
      message: 'after clerkSetup',
      data: { tokenLenAfter, fapiLen },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
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
  const envPk = envPublishableKey();
  const base = opts.baseURL.replace(/\/$/, '');

  if (!opts.skipInitialNavigate) {
    if (envPk) {
      await refreshClerkTestingCredentials(envPk);
    }
    await installDynamicClerkFapiRouteOnce(page.context());
    await page.goto(`${base}/`);
  }

  await waitForClerkOrSignInUi(page, 90_000);
  const pagePk = await readPublishableKeyFromPage(page);
  const publishableKey = (pagePk ?? envPk)?.trim();
  if (!publishableKey) {
    throw new Error(
      'Could not resolve Clerk publishable key: it was not found on the page (window.Clerk.publishableKey / data-clerk-publishable-key) and CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY is unset. Use the **same Clerk application** as the site under test (or set the publishable key env to that app).',
    );
  }

  // #region agent log
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
    body: JSON.stringify({
      sessionId: '5f6bd9',
      hypothesisId: 'H4',
      location: 'clerk-sign-in.ts:performClerkPasswordEmail2FA',
      message: 'publishable key source for clerkSetup',
      data: {
        hasPagePk: Boolean(pagePk),
        pagePkTail: pagePk ? pagePk.slice(-12) : '',
        envPkTail: envPk ? envPk.slice(-12) : '',
        envDiffersFromPage: Boolean(pagePk && envPk && pagePk !== envPk),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  await refreshClerkTestingCredentials(publishableKey);
  await installDynamicClerkFapiRouteOnce(page.context());

  const detach403Logger = attachClerkFapi403DebugLogger(page);
  try {
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
  } finally {
    detach403Logger();
  }
}
