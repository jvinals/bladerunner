import type { Page } from 'playwright-core';

/** Injected overlay root; removed after screenshot. */
export const SOM_CONTAINER_ID = '__bladerunner_som_overlay_root';

/** Max numbered tags (viewport-visible interactives); deterministic overflow drop. */
export const SOM_MAX_TAGS = 250;

/** Max characters of manifest text sent to Gemini (avoid huge prompts). */
export const SOM_MANIFEST_MAX_CHARS = 28000;

export type SetOfMarkInjectResult = {
  /** Human-readable lines `[n] ...` aligned with screenshot badges. */
  manifestText: string;
};

/**
 * Injects high-contrast numeric badges on viewport-visible interactive elements.
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

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      function intersectsViewport(r: DOMRect): boolean {
        return (
          r.width >= 1 &&
          r.height >= 1 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < vh &&
          r.left < vw
        );
      }

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
        if (!intersectsViewport(r)) return true;
        return false;
      }

      const candidates: Element[] = [];
      for (const el of seen) {
        if (!isSkipped(el)) candidates.push(el);
      }

      candidates.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const dy = ra.top - rb.top;
        if (Math.abs(dy) > 1) return dy;
        return ra.left - rb.left;
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

      const lines: string[] = [];
      const root = doc.createElement('div');
      root.id = containerId;
      root.setAttribute('data-bladerunner-som', 'true');
      root.style.cssText = [
        'position:fixed',
        'inset:0',
        'pointer-events:none',
        'z-index:2147483646',
        'overflow:hidden',
      ].join(';');

      picked.forEach((el, i) => {
        const n = i + 1;
        const r = el.getBoundingClientRect();
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
        badge.style.cssText = [
          'position:fixed',
          `left:${Math.min(Math.max(0, r.left), vw - 28)}px`,
          `top:${Math.max(0, r.top - 2)}px`,
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
        'Interactive elements (viewport-visible; numeric badges on the screenshot match [n] below; order is top-to-bottom, then left-to-right):';
      return { manifestText: [header, ...lines].join('\n') };
    },
    { maxTags, containerId: SOM_CONTAINER_ID },
  );
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
