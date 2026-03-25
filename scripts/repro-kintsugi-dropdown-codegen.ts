import 'dotenv/config';
import { chromium } from 'playwright';
import { PrismaService } from '../apps/api/src/modules/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { LlmCredentialsCryptoService } from '../apps/api/src/modules/llm/llm-credentials-crypto.service';
import { LlmConfigService } from '../apps/api/src/modules/llm/llm-config.service';
import { LlmService } from '../apps/api/src/modules/llm/llm.service';

async function main() {
  const prisma = new PrismaService();
  const config = new ConfigService();
  const crypto = new LlmCredentialsCryptoService(config);
  const llmConfig = new LlmConfigService(config, prisma, crypto);
  const llm = new LlmService(config, llmConfig);
  const project = await prisma.project.findFirst({
    where: { name: 'Kintsugi' },
    select: { url: true, testUserEmail: true, testUserPassword: true },
  });
  const latestRun = await prisma.run.findFirst({
    where: { url: 'https://kintsugi.epistemai.net' },
    orderBy: { updatedAt: 'desc' },
    select: { userId: true, id: true, name: true },
  });
  if (!project?.url || !project.testUserEmail || !project.testUserPassword || !latestRun?.userId) {
    throw new Error('Kintsugi config missing');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  try {
    await page.goto(project.url, { waitUntil: 'networkidle', timeout: 120000 });
    await page.locator('input[type="email"], input[name="email"]').first().fill(project.testUserEmail);
    await page.locator('input[type="password"], input[name="password"]').first().fill(project.testUserPassword);
    await page.locator('form button[type="submit"], button[type="submit"]').first().click();
    await page.waitForURL(/kintsugi\.epistemai\.net\/home/, { timeout: 120000 });
    await page.getByRole('button', { name: 'Calendar' }).click();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.getByRole('button', { name: 'Schedule New Appointment' }).click();

    const dialog = page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: 'visible', timeout: 30000 });
    const nameInput = dialog.locator('input[placeholder="First Name Last Name"]').first();
    await nameInput.fill('');
    await nameInput.pressSequentially('Julian', { delay: 50 });
    await page.waitForTimeout(2500);

    const ctx = await page.evaluate(() => {
      const targetText = /julian/i;
      const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
      const selectors = [
        'button:not([disabled])',
        'a[href]',
        'input:not([type="hidden"]):not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'summary',
        '[role="button"]:not([disabled])',
        '[role="link"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="searchbox"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[contenteditable="true"]',
        '[tabindex]:not([tabindex="-1"])',
      ];
      const seen = new Set<Element>();
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => seen.add(el));
      }
      const pointerTextCandidates = Array.from(document.querySelectorAll('*')).filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (seen.has(el)) return false;
        return window.getComputedStyle(el).cursor === 'pointer';
      }) as HTMLElement[];
      for (const el of pointerTextCandidates) {
        const h = el as HTMLElement;
        const st = window.getComputedStyle(h);
        const r = h.getBoundingClientRect();
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
        if (r.width < 1 || r.height < 1) continue;
        const name = ((h.getAttribute('aria-label') || '').trim() ||
          (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 200);
        if (!name) continue;
        let hasPickedAncestor = false;
        for (let p = h.parentElement; p; p = p.parentElement) {
          if (seen.has(p)) {
            hasPickedAncestor = true;
            break;
          }
          if (
            pointerTextCandidates.includes(p as HTMLElement) &&
            (((p.getAttribute('aria-label') || '').trim() ||
              ((p as HTMLElement).innerText || p.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 200))
          ) {
            hasPickedAncestor = true;
            break;
          }
        }
        if (!hasPickedAncestor) seen.add(h);
      }
      const lines: string[] = [];
      for (const el of seen) {
        const h = el as HTMLElement;
        const txt = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
        const ariaLabel = h.getAttribute('aria-label') || '';
        if (!txt && !ariaLabel) continue;
        lines.push(
          `<${h.tagName.toLowerCase()}>${h.getAttribute('role') ? ` role=${JSON.stringify(h.getAttribute('role'))}` : ''} name=${JSON.stringify((txt || ariaLabel).slice(0, 200))}`,
        );
      }
      const somManifest = [
        'Interactive elements (full scrollable page; numeric badges on the screenshot match [n] below; order is top-to-bottom, then left-to-right):',
        ...lines.map((line, i) => `[${i + 1}] ${line}`),
      ].join('\n');
      return {
        somManifest,
        bodyHasJulian: targetText.test(bodyText),
        manifestJulianLines: somManifest.split('\n').filter((line) => /julian/i.test(line)).slice(0, 20),
      };
    });

    const screenshotBase64 = (await page.screenshot({ type: 'jpeg', quality: 85, fullPage: true })).toString('base64');
    const snapshot = await (page as any).accessibility?.snapshot();
    const accessibilitySnapshot = snapshot ? JSON.stringify(snapshot, null, 2) : '';
    const result = await llm.instructionToAction(
      {
        instruction: 'Select the patient that starts with Julian from the dropdown of patients in Patient Information',
        pageUrl: page.url(),
        somManifest: ctx.somManifest,
        accessibilitySnapshot,
        screenshotBase64,
      },
      { userId: latestRun.userId },
    );

    console.log(
      JSON.stringify(
        {
          latestRun,
          bodyHasJulian: ctx.bodyHasJulian,
          manifestJulianLines: ctx.manifestJulianLines,
          draftPlaywrightCode: result.transcript.draftPlaywrightCode ?? null,
          finalPlaywrightCode: result.output.playwrightCode,
          verifyRawResponse: result.transcript.verifyRawResponse ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

void main();
