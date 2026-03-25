import type { Page } from 'playwright-core';

/** Injected overlay root; removed after screenshot. */
export const SOM_CONTAINER_ID = '__bladerunner_som_overlay_root';

/** Max numbered tags (full-page interactives); deterministic overflow drop. */
export const SOM_MAX_TAGS = 350;

/** Max characters of manifest text sent to Gemini (avoid huge prompts). */
export const SOM_MANIFEST_MAX_CHARS = 28000;

export type SetOfMarkInjectResult = {
  /** Human-readable lines `[n] ...` aligned with screenshot badges. */
  manifestText: string;
};

/**
 * Injects high-contrast numeric badges on interactive elements across the full document
 * (aligned with Playwright `page.screenshot({ fullPage: true })`).
 * Call {@link removeSetOfMarkOverlay} after screenshot, typically in `finally`.
 */
export async function injectSetOfMarkOverlay(
  page: Page,
  opts?: { maxTags?: number },
): Promise<SetOfMarkInjectResult> {
  const maxTags = opts?.maxTags ?? SOM_MAX_TAGS;
  const result = await page.evaluate(
    ({ maxTags: cap, containerId }) => {
      const doc = document;
      const existing = doc.getElementById(containerId);
      existing?.remove();

      const seen = new Set<Element>();
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

      function add(el: Element) {
        if (seen.has(el)) return;
        seen.add(el);
      }
      for (const sel of selectors) {
        try {
          doc.querySelectorAll(sel).forEach(add);
        } catch {
          /* invalid selector in old engines */
        }
      }

      const pointerTextCandidates = new Set<HTMLElement>();
      const allElements = Array.from(doc.querySelectorAll('*'));
      for (const el of allElements) {
        if (!(el instanceof HTMLElement)) continue;
        if (seen.has(el)) continue;
        const st = window.getComputedStyle(el);
        if (st.cursor !== 'pointer') continue;
        pointerTextCandidates.add(el);
      }

      const scrollH = Math.max(
        doc.documentElement?.scrollHeight ?? 0,
        doc.body?.scrollHeight ?? 0,
        1,
      );
      const scrollW = Math.max(
        doc.documentElement?.scrollWidth ?? 0,
        doc.body?.scrollWidth ?? 0,
        1,
      );
      const sx = window.scrollX;
      const sy = window.scrollY;

      function isSkipped(el: Element): boolean {
        if (!(el instanceof HTMLElement)) return true;
        const tn = el.tagName;
        if (tn === 'BODY' || tn === 'HTML') return true;
        if (el.closest(`#${containerId}`)) return true;
        if (el.closest('[aria-hidden="true"]')) return true;
        if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return true;
        const t = (el as HTMLInputElement).type;
        if (t === 'hidden') return true;
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return true;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return true;
        return false;
      }

      const candidates: Element[] = [];
      for (const el of seen) {
        if (!isSkipped(el)) candidates.push(el);
      }

      function docXY(el: Element): { docLeft: number; docTop: number } {
        const r = el.getBoundingClientRect();
        return {
          docLeft: r.left + sx,
          docTop: r.top + sy,
        };
      }

      candidates.sort((a, b) => {
        const pa = docXY(a);
        const pb = docXY(b);
        const dy = pa.docTop - pb.docTop;
        if (Math.abs(dy) > 1) return dy;
        return pa.docLeft - pb.docLeft;
      });

      const picked = candidates.slice(0, cap);

      function visibleName(el: Element): string {
        const al = el.getAttribute('aria-label');
        if (al?.trim()) return al.trim().slice(0, 200);
        const labelled = el.getAttribute('aria-labelledby');
        if (labelled) {
          const parts = labelled.split(/\s+/).map((id) => doc.getElementById(id)?.textContent?.trim()).filter(Boolean);
          if (parts.length) return parts.join(' ').slice(0, 200);
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          if (el.placeholder?.trim()) return el.placeholder.trim().slice(0, 200);
          if (el.type === 'submit' || el.type === 'reset' || el.type === 'button') {
            if (el.value?.trim()) return el.value.trim().slice(0, 200);
          }
        }
        if (el instanceof HTMLSelectElement) {
          if (el.value?.trim()) return el.value.trim().slice(0, 200);
        }
        const inner = (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() || '';
        if (inner) return inner.slice(0, 200);
        const tx = el.textContent?.replace(/\s+/g, ' ').trim() || '';
        return tx.slice(0, 200);
      }

      for (const el of pointerTextCandidates) {
        if (isSkipped(el)) continue;
        const name = visibleName(el);
        if (!name) continue;
        let hasPickedAncestor = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (seen.has(p)) {
            hasPickedAncestor = true;
            break;
          }
          if (pointerTextCandidates.has(p)) {
            const parentName = visibleName(p);
            if (parentName) {
              hasPickedAncestor = true;
              break;
            }
          }
        }
        if (!hasPickedAncestor) {
          candidates.push(el);
          seen.add(el);
        }
      }

      const lines: string[] = [];
      const root = doc.createElement('div');
      root.id = containerId;
      root.setAttribute('data-bladerunner-som', 'true');
      root.style.cssText = [
        'position:absolute',
        'left:0',
        'top:0',
        `width:${scrollW}px`,
        `min-height:${scrollH}px`,
        'pointer-events:none',
        'z-index:2147483646',
        'overflow:visible',
      ].join(';');

      picked.forEach((el, i) => {
        const n = i + 1;
        const { docLeft, docTop } = docXY(el);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        let type = '';
        if (el instanceof HTMLInputElement) type = el.type || 'text';
        const name = visibleName(el);
        const id = el.id ? `#${el.id}` : '';
        const testId = el.getAttribute('data-testid');
        const hint = [id ? `id=${id}` : '', testId ? `data-testid=${JSON.stringify(testId)}` : '']
          .filter(Boolean)
          .join(' ');
        lines.push(
          `[${n}] <${tag}>${role ? ` role=${JSON.stringify(role)}` : ''}${type ? ` type=${JSON.stringify(type)}` : ''} name=${JSON.stringify(name)}${hint ? ` | ${hint}` : ''}`,
        );

        const badge = doc.createElement('div');
        badge.textContent = String(n);
        const leftPx = Math.min(Math.max(0, docLeft), scrollW - 8);
        const topPx = Math.max(0, docTop - 2);
        badge.style.cssText = [
          'position:absolute',
          `left:${leftPx}px`,
          `top:${topPx}px`,
          'min-width:18px',
          'height:18px',
          'padding:0 4px',
          'box-sizing:border-box',
          'display:flex',
          'align-items:center',
          'justify-content:center',
          'font:bold 11px/1 system-ui,Segoe UI,sans-serif',
          'color:#000',
          'background:#ffeb3b',
          'border:2px solid #000',
          'border-radius:3px',
          'box-shadow:0 1px 2px rgba(0,0,0,0.45)',
        ].join(';');
        root.appendChild(badge);
      });

      doc.body.appendChild(root);
      const header =
        'Interactive elements (full scrollable page; numeric badges on the screenshot match [n] below; order is top-to-bottom, then left-to-right):';
      return { manifestText: [header, ...lines].join('\n') };
    },
    { maxTags, containerId: SOM_CONTAINER_ID },
  );
  const debug = await page
    .evaluate(() => {
      const target = /julian/i;
      const visibleJulianNodes = Array.from(document.querySelectorAll('*'))
        .map((el) => {
          const h = el as HTMLElement;
          const txt = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
          if (!target.test(txt)) return null;
          const r = h.getBoundingClientRect();
          return {
            tag: h.tagName.toLowerCase(),
            role: h.getAttribute('role') || '',
            text: txt.slice(0, 160),
            ariaHidden: h.getAttribute('aria-hidden') || '',
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .filter(Boolean)
        .slice(0, 20);
      return {
        visibleJulianNodeCount: visibleJulianNodes.length,
        visibleJulianNodes,
      };
    })
    .catch(() => null);
  // #region agent log
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e7bf9'},body:JSON.stringify({sessionId:'8e7bf9',runId:'pre-fix',hypothesisId:'H-som-dropdown',location:'apps/api/src/modules/recording/set-of-mark-capture.ts:injectSetOfMarkOverlay',message:'set-of-mark capture summary',data:{manifestChars:((result as { manifestText?: string }).manifestText || '').length,manifestHasJulian:/julian/i.test((result as { manifestText?: string }).manifestText || ''),visibleJulianNodeCount:debug?.visibleJulianNodeCount ?? null,visibleJulianNodes:debug?.visibleJulianNodes ?? []},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return result as SetOfMarkInjectResult;
}

export async function removeSetOfMarkOverlay(page: Page): Promise<void> {
  await page.evaluate((containerId) => {
    document.getElementById(containerId)?.remove();
  }, SOM_CONTAINER_ID);
}

export function truncateSomManifest(text: string): string {
  const t = text.trim();
  if (t.length <= SOM_MANIFEST_MAX_CHARS) return t;
  return `${t.slice(0, SOM_MANIFEST_MAX_CHARS)}\n… [manifest truncated]`;
}
