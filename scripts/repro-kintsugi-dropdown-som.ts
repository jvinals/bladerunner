import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

type CandidateSummary = {
  tag: string;
  role: string;
  text: string;
  ariaLabel: string;
  className: string;
  skipped?: string;
};

async function main() {
  const prisma = new PrismaClient();
  const project = await prisma.project.findFirst({
    where: { name: 'Kintsugi' },
    select: { url: true, testUserEmail: true, testUserPassword: true },
  });
  if (!project?.url || !project.testUserEmail || !project.testUserPassword) {
    throw new Error('Kintsugi project credentials are not configured');
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
    await dialog.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    const nameCombobox = dialog.locator('button[role="combobox"]').filter({ hasText: 'Name' }).first();
    const comboVisible = await nameCombobox.isVisible().catch(() => false);
    if (!comboVisible) {
      const formDump = await dialog.evaluate((root) => {
        const controls = Array.from(root.querySelectorAll('input, button, [role], label'))
          .map((el) => {
            const h = el as HTMLElement;
            const text = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
            const r = h.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return null;
            return {
              tag: h.tagName.toLowerCase(),
              role: h.getAttribute('role') || '',
              name: h.getAttribute('name') || '',
              ariaLabel: h.getAttribute('aria-label') || '',
              placeholder: h.getAttribute('placeholder') || '',
              text: text.slice(0, 120),
            };
          })
          .filter(Boolean)
          .slice(0, 120);
        return { controls };
      });
      console.log(JSON.stringify({ error: 'name control not found', url: page.url(), formDump }, null, 2));
      return;
    }
    const nameInput = dialog.locator('input[placeholder=\"First Name Last Name\"]').first();
    await nameInput.fill('');
    await nameInput.pressSequentially('Julian', { delay: 50 });
    await page.waitForTimeout(2500);

    const domReport = await page.evaluate(() => {
      const targetText = /julian/i;
      const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
      const all = Array.from(document.querySelectorAll('*'));
      const visibleOptions = Array.from(document.querySelectorAll('[role="option"]'))
        .map((el) => {
          const h = el as HTMLElement;
          const txt = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
          const r = h.getBoundingClientRect();
          const st = window.getComputedStyle(h);
          if (r.width < 1 || r.height < 1 || st.display === 'none' || st.visibility === 'hidden') return null;
          return {
            text: txt.slice(0, 200),
            ariaSelected: h.getAttribute('aria-selected') || '',
            className: typeof h.className === 'string' ? h.className.slice(0, 200) : '',
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .filter(Boolean)
        .slice(0, 20);
      const matching = all
        .filter((el) => targetText.test((el.textContent || '').trim()))
        .map((el) => {
          const h = el as HTMLElement;
          const st = window.getComputedStyle(h);
          const r = h.getBoundingClientRect();
          return {
            tag: h.tagName.toLowerCase(),
            role: h.getAttribute('role') || '',
            text: (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
            ariaLabel: h.getAttribute('aria-label') || '',
            className: typeof h.className === 'string' ? h.className.slice(0, 200) : '',
            display: st.display,
            visibility: st.visibility,
            opacity: st.opacity,
            width: Math.round(r.width),
            height: Math.round(r.height),
            ariaHidden: h.getAttribute('aria-hidden') || '',
          };
        })
        .slice(0, 40);

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
      const somMatching: CandidateSummary[] = [];
      const manifestJulianLines: string[] = [];
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
      for (const el of seen) {
        const h = el as HTMLElement;
        const text = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
        const ariaLabel = h.getAttribute('aria-label') || '';
        if (!targetText.test(text) && !targetText.test(ariaLabel)) continue;
        const st = window.getComputedStyle(h);
        const r = h.getBoundingClientRect();
        let skipped: string | undefined;
        if (h.closest('[aria-hidden="true"]')) skipped = 'aria-hidden';
        else if (h.hasAttribute('disabled') || h.getAttribute('aria-disabled') === 'true') skipped = 'disabled';
        else if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') skipped = 'css-hidden';
        else if (r.width < 1 || r.height < 1) skipped = 'zero-rect';
        somMatching.push({
          tag: h.tagName.toLowerCase(),
          role: h.getAttribute('role') || '',
          text: text.slice(0, 200),
          ariaLabel,
          className: typeof h.className === 'string' ? h.className.slice(0, 200) : '',
          ...(skipped ? { skipped } : {}),
        });
        manifestJulianLines.push(
          `<${h.tagName.toLowerCase()}>${h.getAttribute('role') ? ` role=${JSON.stringify(h.getAttribute('role'))}` : ''} name=${JSON.stringify(text.slice(0, 200) || ariaLabel.slice(0, 200))}`,
        );
      }

      return {
        bodyHasJulian: targetText.test(bodyText),
        bodyJulianExcerpt: bodyText.match(/.{0,120}julian.{0,160}/i)?.[0] ?? '',
        visibleOptions,
        matching,
        somMatching,
        manifestJulianLines,
      };
    });

    console.log(
      JSON.stringify(
        {
          ...domReport,
          manifestHasJulian: domReport.manifestJulianLines.length > 0,
        },
        null,
        2,
      ),
    );
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e7bf9'},body:JSON.stringify({sessionId:'8e7bf9',runId:'post-fix',hypothesisId:'H-som-dropdown',location:'scripts/repro-kintsugi-dropdown-som.ts',message:'dropdown dom vs som report',data:{bodyHasJulian:domReport.bodyHasJulian,visibleOptions:domReport.visibleOptions.length,matching:domReport.matching.length,somMatching:domReport.somMatching.length,manifestHasJulian:domReport.manifestJulianLines.length>0,manifestJulianLines:domReport.manifestJulianLines.slice(0,10)},timestamp:Date.now()})}).catch(()=>{});
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

void main();
