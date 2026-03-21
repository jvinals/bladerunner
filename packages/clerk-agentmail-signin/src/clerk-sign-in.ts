import type { BrowserContext, Page } from 'playwright-core';
import { clerkSetup } from '@clerk/testing/playwright';
import { waitForClerkOtpFromMailSlurp } from './mailslurp-otp';

/** Locators for Clerk / app email OTP fields (broader than legacy `detectClerkSignInUi`). */
function otpInputLocator(page: Page) {
  return page
    .locator(
      [
        'input[inputmode="numeric"]',
        'input[name="code"]',
        'input[autocomplete="one-time-code"]',
        '[data-input-otp]',
        'input[type="text"][inputmode="numeric"]',
        'input[placeholder*="code" i]',
        'input[placeholder*="verification" i]',
        'input[aria-label*="code" i]',
        'input[aria-label*="verification" i]',
      ].join(', '),
    )
    .first();
}

/** Same query param as `@clerk/testing` Playwright route (see `@clerk/testing` chunk-M5YIJ3SE). */
const CLERK_TESTING_TOKEN_PARAM = '__clerk_testing_token';

/**
 * One dynamic route per context: matches `https://${CLERK_FAPI}/v1/*` using **current** env on each request,
 * so `clerkSetup` can switch FAPI (e.g. after reading the **target app’s** publishable key) without stacking
 * incompatible `RegExp` handlers from `setupClerkTestingToken`.
 */
const contextsWithDynamicClerkFapiRoute = new WeakSet<BrowserContext>();

/** Optional comma-separated extra Frontend API hostnames (no protocol) if the app uses a proxy/satellite domain. */
function extraFapiHostsFromEnv(): Set<string> {
  const raw = process.env.CLERK_FAPI_EXTRA_HOSTS;
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const h = part.trim().toLowerCase();
    if (h) out.add(h);
  }
  return out;
}

/**
 * True when this URL should receive `__clerk_testing_token`.
 * Strict `hostname === CLERK_FAPI` misses satellite/proxy/custom Clerk domains (→ 403 if the
 * browser never hits the configured host).
 */
function shouldInterceptClerkFapiUrl(url: URL): boolean {
  const proto = url.protocol.toLowerCase();
  if (proto !== 'https:' && proto !== 'http:') return false;
  if (!url.pathname.startsWith('/v1/')) return false;
  const fapi = process.env.CLERK_FAPI;
  if (!fapi) return false;
  const h = url.hostname.toLowerCase();
  const f = fapi.toLowerCase();
  if (h === f) return true;
  if (extraFapiHostsFromEnv().has(h)) return true;
  const fSlug = f.split('.')[0] ?? '';
  const hSlug = h.split('.')[0] ?? '';
  if (fSlug && hSlug && fSlug === hSlug && f.includes('clerk')) {
    if (h.includes('clerk') || h.includes('accounts.dev') || h.endsWith('.lcl.dev')) return true;
  }
  return false;
}

function envPublishableKey(): string | undefined {
  const k =
    process.env.CLERK_PUBLISHABLE_KEY ||
    process.env.VITE_CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return k?.trim() || undefined;
}

/**
 * Clerk **testing token** (`clerkSetup`) must use a **secret for the same Clerk instance** as the
 * publishable key (often the **app under test**). Bladerunner’s API auth still uses `CLERK_SECRET_KEY`;
 * when that instance differs, set **`PLAYBACK_CLERK_SECRET_KEY`** or **`E2E_CLERK_SECRET_KEY`**.
 */
function clerkSecretKeyForTesting(): string | undefined {
  const playback = process.env.PLAYBACK_CLERK_SECRET_KEY?.trim();
  if (playback) return playback;
  const e2e = process.env.E2E_CLERK_SECRET_KEY?.trim();
  if (e2e) return e2e;
  return process.env.CLERK_SECRET_KEY?.trim();
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

  await context.route(
    (url) => shouldInterceptClerkFapiUrl(url),
    async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const token = process.env.CLERK_TESTING_TOKEN;
      if (token) {
        u.searchParams.set(CLERK_TESTING_TOKEN_PARAM, token);
      }
      try {
        const response = await route.fetch({ url: u.toString() });
        const bodyText = await response.text();
        const headers = response.headers();
        let bodyOut = bodyText;
        try {
          const json = JSON.parse(bodyText) as unknown;
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
            bodyOut = JSON.stringify(json);
          }
        } catch {
          /* not JSON — pass raw body */
        }
        await route.fulfill({
          status: response.status(),
          headers,
          body: bodyOut,
        });
      } catch {
        await route.continue({ url: u.toString() }).catch(() => {});
      }
    },
  );
}

/**
 * Refresh `CLERK_FAPI` + `CLERK_TESTING_TOKEN` for the given publishable key (always clears stale token first).
 */
async function refreshClerkTestingCredentials(publishableKey: string): Promise<void> {
  const secretKey = clerkSecretKeyForTesting();
  if (!secretKey) {
    throw new Error(
      'clerkSetup requires CLERK_SECRET_KEY, or PLAYBACK_CLERK_SECRET_KEY / E2E_CLERK_SECRET_KEY when the target app uses a different Clerk instance than Bladerunner.',
    );
  }
  delete process.env.CLERK_TESTING_TOKEN;
  const frontendApiUrl = process.env.CLERK_TESTING_FRONTEND_API_URL?.trim();
  await clerkSetup({
    publishableKey,
    secretKey,
    dotenv: false,
    ...(frontendApiUrl ? { frontendApiUrl } : {}),
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

/** True when the page has navigated back to the app under test (not Clerk hosted UI). */
function isAppHostUrl(url: URL, appHostname: string): boolean {
  const h = url.hostname;
  return h === appHostname || h === 'localhost' || h === '127.0.0.1';
}

/**
 * Clerk sometimes advances immediately after OTP (no Continue/Verify), or uses different
 * button labels. Try several role/name patterns; return whether a button was clicked.
 */
async function tryClickPostOtpSubmit(page: Page): Promise<boolean> {
  const namePatterns = [
    /^Continue$/i,
    /^Verify$/i,
    /^Submit$/i,
    /^Done$/i,
    /^Complete$/i,
    /^Enter$/i,
    /^Sign in$/i,
    /^Next$/i,
  ];
  for (const pattern of namePatterns) {
    const btn = page.getByRole('button', { name: pattern }).first();
    try {
      await btn.waitFor({ state: 'visible', timeout: 1_500 });
      await btn.click({ timeout: 5_000 });
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
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
 * True when a one-time / verification code field is visible (Clerk hosted or in-app).
 */
export async function detectClerkOtpInputVisible(page: Page): Promise<boolean> {
  return otpInputLocator(page).isVisible().catch(() => false);
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
    const otp = otpInputLocator(page);
    const otpVisible = await otp.isVisible().catch(() => false);
    if (!otpVisible) return true;
  }

  return detectClerkOtpInputVisible(page);
}

export type FillClerkOtpFromMailSlurpOpts = {
  /** Run / app URL (used for post-OTP redirect wait). */
  runUrl: string;
  /**
   * Only accept MailSlurp emails received at or after this time (ms since epoch).
   * Use `Date.now()` right after password submit in full flow; for OTP-only screens use a recent window.
   */
  notBeforeMs: number;
};

/**
 * Fill visible OTP field(s) using MailSlurp — use when identifier field is not shown (post-password / OTP-only).
 */
export async function fillClerkOtpFromMailSlurp(
  page: Page,
  opts: FillClerkOtpFromMailSlurpOpts,
): Promise<void> {
  const pagePk = await readPublishableKeyFromPage(page);
  const publishableKey = (pagePk ?? envPublishableKey())?.trim();
  if (publishableKey) {
    await refreshClerkTestingCredentials(publishableKey);
    await installDynamicClerkFapiRouteOnce(page.context());
  }

  const otpSingle = otpInputLocator(page);
  try {
    await otpSingle.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    const anyOtp = page.locator('input[inputmode="numeric"]').first();
    await anyOtp.waitFor({ state: 'visible', timeout: 45_000 });
  }

  const otp = await waitForClerkOtpFromMailSlurp({
    notBeforeMs: opts.notBeforeMs,
    timeoutMs: 120_000,
  });

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

  const host = new URL(
    opts.runUrl.includes('://') ? opts.runUrl : `https://${opts.runUrl}`,
  ).hostname;

  try {
    await page.waitForURL((url) => isAppHostUrl(url, host), { timeout: 20_000 });
  } catch {
    let clicked = await tryClickPostOtpSubmit(page);
    if (!clicked) {
      try {
        await locatorAfterOtpSubmit(page).first().click({ timeout: 5_000 });
        clicked = true;
      } catch {
        /* final waitForURL may still succeed */
      }
    }
  }

  await page.waitForURL((url) => isAppHostUrl(url, host), { timeout: 120_000 });
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

  await refreshClerkTestingCredentials(publishableKey);
  await installDynamicClerkFapiRouteOnce(page.context());

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
  await passwordField.fill(opts.password);

  await locatorAfterPasswordSubmit(page).first().click();
  /** Clerk sends the OTP email after this moment — only accept MailSlurp messages received after here. */
  const otpWindowStartMs = Date.now();

  await fillClerkOtpFromMailSlurp(page, {
    runUrl: opts.baseURL,
    notBeforeMs: otpWindowStartMs,
  });
}
