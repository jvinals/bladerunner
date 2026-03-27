import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Page } from 'playwright';
import { detectLikelyClerkLoginPage, performProjectPasswordSignIn } from './project-auto-sign-in';

const creds = {
  identifier: 'user@example.com',
  password: 'hunter2',
  otpMode: 'clerk_test_email',
} as const;

function html(body: string, script = ''): string {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>project auto sign-in selftest</title>
      <style>
        body { font-family: sans-serif; padding: 24px; }
        form, .panel { display: grid; gap: 12px; max-width: 360px; }
        input, button { font: inherit; padding: 8px 12px; }
      </style>
    </head>
    <body>
      ${body}
      <script>${script}</script>
    </body>
  </html>`;
}

function delayedCombinedPage(): string {
  return html(
    '<div id="mount" class="panel"><p>Loading sign-in form...</p></div>',
    `
      const mount = document.getElementById('mount');
      setTimeout(() => {
        mount.innerHTML = '<form id="login"><input type="email" name="email" autocomplete="email" placeholder="Email" /><input type="password" name="password" placeholder="Password" /><button type="submit">Sign in</button></form>';
        document.getElementById('login')?.addEventListener('submit', (event) => {
          event.preventDefault();
          window.location.href = '/done';
        });
      }, 900);
    `,
  );
}

function twoStepGenericPage(): string {
  return html(
    `
      <div id="stage-email">
        <form id="email-form">
          <input type="email" name="email" autocomplete="email" placeholder="Email" />
          <button type="submit">Continue</button>
        </form>
      </div>
      <div id="stage-password" hidden>
        <form id="password-form">
          <input type="password" name="password" placeholder="Password" />
          <button type="submit">Sign in</button>
        </form>
      </div>
      <div id="stage-otp" hidden>
        <label>
          Verification code
          <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" />
        </label>
      </div>
    `,
    `
      const emailStage = document.getElementById('stage-email');
      const passwordStage = document.getElementById('stage-password');
      const otpStage = document.getElementById('stage-otp');
      document.getElementById('email-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        emailStage.hidden = true;
        passwordStage.hidden = false;
      });
      document.getElementById('password-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        passwordStage.hidden = true;
        otpStage.hidden = false;
      });
      document.querySelector('input[name="code"]')?.addEventListener('input', (event) => {
        const value = event.currentTarget?.value || '';
        if (String(value).replace(/\\D/g, '').length >= 6) {
          window.location.href = '/done';
        }
      });
    `,
  );
}

function donePage(): string {
  return html('<h1>Signed in</h1>');
}

async function withServer<T>(fn: (origin: string) => Promise<T>): Promise<T> {
  const server = createServer((req, res) => {
    const path = req.url || '/';
    const page =
      path === '/delayed-combined'
        ? delayedCombinedPage()
        : path === '/two-step'
          ? twoStepGenericPage()
          : donePage();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function runScenario(
  page: Page,
  name: string,
  url: string,
  delayBeforeSignInMs = 0,
): Promise<boolean> {
  await page.goto(url);
  const authKind = await detectLikelyClerkLoginPage(page);
  if (delayBeforeSignInMs > 0) {
    await page.waitForTimeout(delayBeforeSignInMs);
  }
  try {
    await performProjectPasswordSignIn(page, url, creds);
    const passed = page.url().endsWith('/done');
    if (passed) {
      console.log(`[${name}] PASS authKind=${authKind} finalUrl=${page.url()}`);
      return true;
    }
    console.log(`[${name}] FAIL authKind=${authKind} finalUrl=${page.url()} expected=/done`);
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[${name}] FAIL authKind=${authKind} message=${message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const ok = await withServer(async (origin) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      const results = await Promise.all([
        runScenario(page, 'delayed-combined-immediate', `${origin}/delayed-combined`),
        (async () => {
          const nextPage = await browser.newPage();
          try {
            return await runScenario(nextPage, 'delayed-combined-after-wait', `${origin}/delayed-combined`, 1_200);
          } finally {
            await nextPage.close();
          }
        })(),
        (async () => {
          const nextPage = await browser.newPage();
          try {
            return await runScenario(nextPage, 'two-step-generic', `${origin}/two-step`);
          } finally {
            await nextPage.close();
          }
        })(),
      ]);
      return results.every(Boolean);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
