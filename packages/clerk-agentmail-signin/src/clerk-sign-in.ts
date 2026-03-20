import type { BrowserContext, Page, Request, Response } from 'playwright-core';
import { clerkSetup } from '@clerk/testing/playwright';
import { waitForClerkOtpFromMailSlurp } from './mailslurp-otp';

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
 * Strict `hostname === CLERK_FAPI` misses satellite/proxy/custom Clerk domains (→ 403 with no H5 if the
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

  let interceptLogCount = 0;
  let upstreamStatusLogCount = 0;
  let routeFetchErrorLogCount = 0;
  await context.route(
    (url) => shouldInterceptClerkFapiUrl(url),
    async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const token = process.env.CLERK_TESTING_TOKEN;
      const hadTestingToken = Boolean(token);
      if (token) {
        u.searchParams.set(CLERK_TESTING_TOKEN_PARAM, token);
      }
      if (interceptLogCount < 8) {
        interceptLogCount += 1;
        const fapi = process.env.CLERK_FAPI ?? '';
        // #region agent log
        fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
          body: JSON.stringify({
            sessionId: '5f6bd9',
            hypothesisId: 'H8',
            location: 'clerk-sign-in.ts:clerkFapiRoute',
            message: 'intercepted Clerk FAPI request (appending testing token)',
            data: {
              requestHost: u.hostname,
              configuredFapiTail: fapi ? fapi.slice(-24) : '',
              hostEqFapi: u.hostname.toLowerCase() === fapi.toLowerCase(),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      }
      try {
        const response = await route.fetch({ url: u.toString() });
        const st = response.status();
        // Always sample first N upstream statuses so "no H9" cannot mean "logger broken" — it means
        // previously we only logged ≥400; all your intercepts returned <400 (Clerk accepted them).
        if (upstreamStatusLogCount < 24) {
          upstreamStatusLogCount += 1;
          // #region agent log
          fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
            body: JSON.stringify({
              sessionId: '5f6bd9',
              hypothesisId: 'H9',
              location: 'clerk-sign-in.ts:clerkFapiRoute',
              message: 'upstream FAPI response after appending __clerk_testing_token',
              data: {
                status: st,
                method: req.method(),
                pathPrefix: u.pathname.slice(0, 72),
                hadTestingToken,
                atOrAbove400: st >= 400,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
        }
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
      } catch (err) {
        if (routeFetchErrorLogCount < 12) {
          routeFetchErrorLogCount += 1;
          const msg = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160);
          // #region agent log
          fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
            body: JSON.stringify({
              sessionId: '5f6bd9',
              hypothesisId: 'H10',
              location: 'clerk-sign-in.ts:clerkFapiRoute',
              message: 'route.fetch failed; continuing without rewritten response (token may be lost)',
              data: { errorPrefix: msg, hadTestingToken },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
        }
        await route.continue({ url: u.toString() }).catch(() => {});
      }
    },
  );
}

function attachClerkFapiErrorDebugLogger(page: Page): () => void {
  const handler = (res: Response) => {
    const url = res.url();
    const st = res.status();
    if (st < 400) return;
    if (!url.includes('/v1/') && !url.toLowerCase().includes('clerk')) return;
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
        message: 'Clerk-related HTTP error response',
        data: {
          status: st,
          responseHost: host,
          configuredFapiTail: fapi ? fapi.slice(-24) : '',
          hostMatchesFapi: !!(fapi && host.toLowerCase() === fapi.toLowerCase()),
          pathPrefix: (() => {
            try {
              return new URL(url).pathname.slice(0, 48);
            } catch {
              return '';
            }
          })(),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  };
  page.on('response', handler);
  return () => page.off('response', handler);
}

/** Log hosts for /v1/ traffic so we can see FAPI hostname drift vs CLERK_FAPI. */
function attachClerkV1RequestProbe(page: Page): () => void {
  let n = 0;
  const handler = (req: Request) => {
    if (n >= 24) return;
    const url = req.url();
    if (!url.includes('/v1/')) return;
    n += 1;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* ignore */
    }
    const fapi = process.env.CLERK_FAPI ?? '';
    // #region agent log
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
      body: JSON.stringify({
        sessionId: '5f6bd9',
        hypothesisId: 'H7',
        location: 'clerk-sign-in.ts:request',
        message: 'saw /v1/ request',
        data: {
          host,
          hostEqFapi: !!(fapi && host.toLowerCase() === fapi.toLowerCase()),
          wouldIntercept: shouldInterceptClerkFapiUrl(new URL(url)),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  };
  page.on('request', handler);
  return () => page.off('request', handler);
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
  const secretSource = process.env.PLAYBACK_CLERK_SECRET_KEY?.trim()
    ? 'PLAYBACK_CLERK_SECRET_KEY'
    : process.env.E2E_CLERK_SECRET_KEY?.trim()
      ? 'E2E_CLERK_SECRET_KEY'
      : 'CLERK_SECRET_KEY';
  // #region agent log
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
    body: JSON.stringify({
      sessionId: '5f6bd9',
      hypothesisId: 'H6',
      location: 'clerk-sign-in.ts:refreshClerkTestingCredentials',
      message: 'Clerk secret source for clerkSetup (not the key value)',
      data: { secretSource },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

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
  const frontendApiUrl = process.env.CLERK_TESTING_FRONTEND_API_URL?.trim();
  await clerkSetup({
    publishableKey,
    secretKey,
    dotenv: false,
    ...(frontendApiUrl ? { frontendApiUrl } : {}),
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

  const detachErrorLogger = attachClerkFapiErrorDebugLogger(page);
  const detachV1Probe = attachClerkV1RequestProbe(page);
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

    const otp = await waitForClerkOtpFromMailSlurp({ notBeforeMs, timeoutMs: 120_000 });

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
    detachErrorLogger();
    detachV1Probe();
  }
}
