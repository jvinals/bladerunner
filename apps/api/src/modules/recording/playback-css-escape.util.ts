/**
 * Tailwind utilities use `:` in class names (e.g. `hover:bg-accent`). In CSS selectors those
 * colons are parsed as pseudo-class boundaries, so `querySelector` throws. Escape as `\\:`.
 * Do not escape when the colon starts a real CSS pseudo-class (e.g. `foo:hover`, `div:first-child`).
 */

const CSS_PSEUDO_AFTER_FIRST_COLON = new Set([
  'hover',
  'focus',
  'focus-visible',
  'focus-within',
  'active',
  'visited',
  'disabled',
  'checked',
  'indeterminate',
  'default',
  'enabled',
  'required',
  'valid',
  'invalid',
  'in-range',
  'out-of-range',
  'read-only',
  'read-write',
  'placeholder-shown',
  'autofill',
  'first-child',
  'last-child',
  'only-child',
  'first-of-type',
  'last-of-type',
  'only-of-type',
  'nth-child',
  'nth-last-child',
  'nth-of-type',
  'nth-last-of-type',
  'empty',
  'root',
  'target',
  'scope',
  'any-link',
  'link',
  'local-link',
  'placeholder',
  'before',
  'after',
  'first-line',
  'first-letter',
  'selection',
  'file',
  'backdrop',
  'marker',
  'spelling-error',
  'grammar-error',
  'fullscreen',
  'modal',
  'popover-open',
  'lang',
  'dir',
  'not',
  'is',
  'where',
  'has',
  'host',
  'part',
]);

function restAfterFirstColonLooksLikeCssPseudo(rest: string): boolean {
  const name = rest.split('(')[0].trim();
  return CSS_PSEUDO_AFTER_FIRST_COLON.has(name);
}

/** Per `.` segment in a simple class chain: escape `:` when it is Tailwind-style, not CSS pseudo. */
export function escapeTailwindColonsInCssSelector(selector: string): string {
  if (!selector || selector.includes('[') || selector.includes(']') || selector.includes(' ')) {
    return selector;
  }
  const parts = selector.split('.');
  const out = parts.map((segment) => {
    if (!segment.includes(':')) return segment;
    const i = segment.indexOf(':');
    const rest = segment.slice(i + 1);
    if (restAfterFirstColonLooksLikeCssPseudo(rest)) {
      return segment;
    }
    return segment.replace(/:/g, '\\:');
  });
  return out.join('.');
}

/**
 * Rewrite first-arg CSS strings in `page.locator('...')` / `page.locator("...")` for playback.
 * Uses `JSON.stringify` for the argument so backslashes from Tailwind `\\:` survive when the snippet is
 * later embedded in `new Function('…', 'return (async () => { … })();')` — a single-quoted
 * `page.locator('…\\:…')` would re-parse as `locator('…:…')` and drop the escape, breaking `querySelectorAll`.
 */
export function escapeLocatorCssInPlaywrightSnippet(code: string): string {
  let out = code.replace(/\.locator\(\s*'([^']*)'\)/g, (_m, css: string) => {
    return `.locator(${JSON.stringify(escapeTailwindColonsInCssSelector(css))})`;
  });
  // Do not re-process strings produced above: they contain `\\:` sequences that would get a third `\` if we escaped again.
  out = out.replace(/\.locator\(\s*"([^"]*)"\)/g, (_m, css: string) => {
    if (/\\\\:/.test(css)) {
      return _m;
    }
    return `.locator(${JSON.stringify(escapeTailwindColonsInCssSelector(css))})`;
  });
  return out;
}
