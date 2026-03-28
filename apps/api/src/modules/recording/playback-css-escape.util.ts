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

function escapeCssIdentifier(value: string): string {
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9_-]/.test(ch)) {
      out += ch;
      continue;
    }
    out += `\\${ch}`;
  }
  return out;
}

function escapeSimpleClassChainSegment(segment: string): string {
  if (!segment) return segment;
  const i = segment.indexOf(':');
  if (i > 0) {
    const rest = segment.slice(i + 1);
    if (restAfterFirstColonLooksLikeCssPseudo(rest)) {
      return `${escapeCssIdentifier(segment.slice(0, i))}:${rest}`;
    }
  }
  return escapeCssIdentifier(segment);
}

/** Per `.` segment in a simple class chain: escape Tailwind class syntax, but keep real CSS pseudos intact. */
export function escapeTailwindColonsInCssSelector(selector: string): string {
  if (!selector || selector.includes(' ')) {
    return selector;
  }
  const parts = selector.split('.');
  if (parts.length <= 1) return selector;
  const [head, ...tail] = parts;
  return [head, ...tail.map(escapeSimpleClassChainSegment)].join('.');
}

/**
 * Rewrite first-arg CSS strings in `page.locator('...')` / `page.locator("...")` for playback.
 * Uses `JSON.stringify` for the argument so backslashes from Tailwind `\\:` survive when the snippet is
 * later embedded in `new Function('…', 'return (async () => { … })();')` — a single-quoted
 * `page.locator('…\\:…')` would re-parse as `locator('…:…')` and drop the escape, breaking `querySelectorAll`.
 */
function findStringLiteralEnd(code: string, start: number, quote: '"' | "'"): number {
  for (let i = start; i < code.length; i += 1) {
    if (code[i] !== quote) continue;
    let lookahead = i + 1;
    while (lookahead < code.length && /\s/.test(code[lookahead] ?? '')) lookahead += 1;
    if (code[lookahead] === ')') {
      return i;
    }
  }
  let backslashRun = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '\\') {
      backslashRun += 1;
      continue;
    }
    if (ch === quote && backslashRun % 2 === 0) {
      return i;
    }
    backslashRun = 0;
  }
  return -1;
}

export function escapeLocatorCssInPlaywrightSnippet(code: string): string {
  let out = '';
  let idx = 0;
  while (idx < code.length) {
    const locatorIdx = code.indexOf('.locator(', idx);
    if (locatorIdx < 0) {
      out += code.slice(idx);
      break;
    }
    out += code.slice(idx, locatorIdx);
    let cursor = locatorIdx + '.locator('.length;
    while (cursor < code.length && /\s/.test(code[cursor] ?? '')) cursor += 1;
    const quote = code[cursor];
    if (quote !== '"' && quote !== "'") {
      out += '.locator(';
      idx = cursor;
      continue;
    }
    const literalStart = cursor + 1;
    const literalEnd = findStringLiteralEnd(code, literalStart, quote);
    if (literalEnd < 0) {
      out += code.slice(locatorIdx);
      break;
    }
    const rawCss = code.slice(literalStart, literalEnd);
    const rewrittenCss = escapeTailwindColonsInCssSelector(rawCss);
    out += `${code.slice(locatorIdx, cursor)}${JSON.stringify(rewrittenCss)}`;
    idx = literalEnd + 1;
  }
  return out;
}
