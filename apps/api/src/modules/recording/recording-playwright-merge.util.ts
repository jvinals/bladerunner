/**
 * LLM `actionToInstruction` often returns `page.locator('span')` while the injected `getSelector(target)`
 * is a concrete CSS path (e.g. `span.ml-2.text-sm`). Playback relaxes bare tags to `.first()`, which
 * clicks the wrong node and leaves the wrong URL — later steps (e.g. `td...`) then time out.
 *
 * When the recorded selector is more specific than a bare tag (has `.`, `#`, or `[`), replace
 * bare `page.locator('tag')` with `page.locator(<recordedSelector>)` (JSON-escaped).
 */
export function preferRecordedCssSelectorForBarePageLocator(
  recordedSelector: string | null | undefined,
  playwrightCode: string,
): string {
  if (!recordedSelector?.trim()) return playwrightCode;
  const sel = recordedSelector.trim();
  if (!/[.#\[]/.test(sel)) return playwrightCode;

  if (/getByRole|getByText|getByLabel|getByPlaceholder|getByTestId/i.test(playwrightCode)) {
    return playwrightCode;
  }

  const re = /\bpage\.locator\s*\(\s*(['"])([a-zA-Z][a-zA-Z0-9]*)\1\s*\)/g;
  return playwrightCode.replace(re, (full, _q: string, tag: string) => {
    const t = tag.toLowerCase();
    const lower = sel.toLowerCase();
    if (!lower.startsWith(t)) return full;
    if (sel.length > tag.length) {
      const next = sel[tag.length]!;
      if (next !== '.' && next !== '#' && next !== '[') return full;
    }
    if (lower === t) return full;
    return `page.locator(${JSON.stringify(sel)})`;
  });
}

/**
 * When the LLM still emits `page.locator('span').first().click()` but we have visible label text
 * (e.g. nav item "Patients") because recorded HTML used to omit children, prefer `getByText`.
 */
export function preferGetByTextForBareTagLocator(
  recordedSelector: string | null | undefined,
  elementVisibleText: string | null | undefined,
  playwrightCode: string,
): string {
  const text = elementVisibleText?.trim();
  if (!text || text.length > 200) return playwrightCode;
  const sel = (recordedSelector ?? '').trim();
  if (!sel) return playwrightCode;
  if (!/^[a-z][a-z0-9]*$/i.test(sel)) return playwrightCode;
  const tag = sel.toLowerCase();
  if (!['span', 'div', 'a', 'button', 'i', 'svg', 'label', 'p'].includes(tag)) return playwrightCode;

  const byText = `page.getByText(${JSON.stringify(text)}, { exact: true }).first().click()`;
  for (const q of ["'", '"', '`'] as const) {
    const needle = `page.locator(${q}${tag}${q}).first().click()`;
    if (playwrightCode.includes(needle)) {
      return playwrightCode.replace(needle, byText);
    }
  }
  return playwrightCode;
}

/**
 * Playback: `getByText('Patients', { exact: false })` matches "Total Patients" and other substrings.
 * Prefer exact full-string match; ensure `.first()` before `.click()` when multiple exact matches exist.
 */
export function tightenGetByTextLocatorsForPlayback(playwrightCode: string): string {
  let s = playwrightCode;
  s = s.replace(
    /\.getByText\(([^,]+),\s*\{\s*exact:\s*false\s*\}\)/g,
    '.getByText($1, { exact: true })',
  );
  s = s.replace(
    /\.getByText\(\s*(['"`])([^'"`]*)\1\s*(?:,\s*\{\s*exact:\s*true\s*\})?\s*\)(?!\s*\.first\(\))(\s*\.click\(\))/g,
    (_m, q: string, text: string, clickPart: string) =>
      `.getByText(${q}${text}${q}, { exact: true }).first()${clickPart}`,
  );
  return s;
}

/**
 * Playback: LLM codegen often uses `page.locator('span')`, `page.locator('svg.lucide-x')`, or
 * `page.locator('path[d="…"]')` (Lucide path shapes). Those can match many nodes (strict mode).
 * Append `.first()` when the chain is not already narrowed (first/nth/filter/locator/getBy).
 * For `path[…]` only: scope to `getByRole('dialog').last()` so `.first()` does not pick an X icon
 * outside the modal (e.g. row “remove” vs modal close).
 */
export function relaxPageLocatorFirstForPlayback(playwrightCode: string): string {
  const alreadyNarrowed = String.raw`(?!\s*\.(?:first|nth|filter|locator|last|getBy))`;
  let s = playwrightCode;
  const bareTag = String.raw`\bpage\.locator\s*\(\s*(['"\`])(span|div|p|a|button|input|table|tr|td|tbody|thead)\1\s*\)${alreadyNarrowed}`;
  s = s.replace(new RegExp(bareTag, 'gi'), (_full, quote: string, tag: string) => `page.locator(${quote}${tag}${quote}).first()`);
  const compoundClassChain = String.raw`\bpage\.locator\s*\(\s*(['"\`])([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+)\1\s*\)${alreadyNarrowed}`;
  s = s.replace(
    new RegExp(compoundClassChain, 'gi'),
    (_full, quote: string, sel: string) => `page.locator(${quote}${sel}${quote}).first()`,
  );
  const tagWithAttr = String.raw`\bpage\.locator\s*\(\s*(['"\`])([a-zA-Z][a-zA-Z0-9]*(?:\[[^\]]*\])+)\1\s*\)${alreadyNarrowed}`;
  s = s.replace(new RegExp(tagWithAttr, 'gi'), (_full, quote: string, sel: string) => {
    if (/^path\[/i.test(sel)) {
      return `page.getByRole('dialog').last().locator(${quote}${sel}${quote}).first()`;
    }
    return `page.locator(${quote}${sel}${quote}).first()`;
  });
  return s;
}

/**
 * Playback: EHR-style UIs often place a hidden `type=file` import input immediately after a section label.
 * `xpath=following::input` then targets that node → "Element is not visible". Prefer the real search field when
 * the label text matches the common "Add disease…" heading and the UI uses the standard placeholder.
 */
export function preferSearchConditionsPlaceholderOverFollowingInputLabel(playwrightCode: string): string {
  const re =
    /\bpage\.locator\(\s*(['"])(?:div|div,\s*label,\s*p)\1\s*\)\s*\.filter\(\s*\{\s*hasText:\s*\/[^/]*Add disease to today[^/]*\/\s*\}\s*\)\s*\.locator\(\s*\1xpath=following::input\1\s*\)/gi;
  return playwrightCode.replace(re, `page.getByPlaceholder('Search conditions...')`);
}

/**
 * Playback: `locator('xpath=following::input')` often resolves to a hidden `type=file` before the real field.
 * Narrow the XPath; use {@link preferSearchConditionsPlaceholderOverFollowingInputLabel} when the placeholder is known.
 */
export function excludeFileInputFromFollowingInputXPath(playwrightCode: string): string {
  return playwrightCode.replace(
    /\.locator\(\s*(['"])xpath=following::input\1\s*\)/gi,
    (_full, quote: string) => {
      const inner =
        quote === "'"
          ? `xpath=following::input[not(@type="file")]`
          : `xpath=following::input[not(@type='file')]`;
      return `.locator(${quote}${inner}${quote})`;
    },
  );
}

/**
 * Playback: `executePwCode` runs snippets via `new Function` (plain JavaScript). LLM output sometimes includes
 * TypeScript non-null assertions (`expr!.prop`), which throw `SyntaxError: Unexpected token '!'` at parse time.
 */
export function stripTypeScriptNonNullAssertionsForPlayback(playwrightCode: string): string {
  let s = playwrightCode;
  for (let i = 0; i < 12; i++) {
    const before = s;
    s = s.replace(/\)\s*!\s*\./g, ').');
    s = s.replace(/\]\s*!\s*\./g, '].');
    s = s.replace(/(\w+)\s*!\s*\./g, '$1.');
    s = s.replace(/\)\s*!\s*\(/g, ')(');
    s = s.replace(/\]\s*!\s*\(/g, '](');
    s = s.replace(/(\w+)\s*!\s*\(/g, '$1(');
    s = s.replace(/\]\s*!\s*\[/g, '][');
    if (s === before) break;
  }
  return s;
}

/**
 * Playback: Radix/modal layers often report "subtree intercepts pointer events" — Playwright refuses the click.
 * `force: true` skips that actionability check and dispatches to the locator’s element (see Playwright input docs).
 */
export function relaxClickForceForPlayback(playwrightCode: string): string {
  return playwrightCode.replace(/\.click\(\s*\)/g, '.click({ force: true })');
}

/**
 * `locator('table tr:last-child td')` matches **every** `<td>` in the last row → strict mode violation.
 * Append `.first()` when the chain is not already narrowed (first/nth/filter/locator/getBy).
 */
export function fixAmbiguousTableLastRowTdLocator(playwrightCode: string): string {
  const notNarrowed = String.raw`(?!\s*\.(?:first|nth|last|filter|locator|getBy))`;
  return playwrightCode.replace(
    new RegExp(
      String.raw`(\b(?:page\.)?locator\(\s*['"]table tr:last-child td['"]\s*\))${notNarrowed}`,
      'g',
    ),
    '$1.first()',
  );
}

/**
 * Playback: some shadcn/Radix-style dropdown triggers visually show a label like "Select Provider" but
 * Playwright's accessible-role query resolves zero matches for `getByRole('combobox', { name })`.
 * Keep the original role/name lookup first, then fall back to visible-text combobox/button locators.
 */
export function fallbackNamedComboboxClicksForPlayback(playwrightCode: string): string {
  return playwrightCode.replace(
    /\bawait\s+page\.getByRole\(\s*(['"`])combobox\1\s*,\s*\{\s*name:\s*(['"`])([^'"`\n\r]+)\2\s*\}\s*\)(\s*\.first\(\))?(\s*\.click\(\s*(?:\{[^)]*\})?\s*\))\s*;?/g,
    (_full, _roleQuote: string, _nameQuote: string, rawName: string, firstPart: string, clickPart: string) => {
      const name = String(rawName).trim();
      if (!name || name.length > 160) return _full;
      const qName = JSON.stringify(name);
      const first = firstPart ?? '';
      const click = clickPart ?? '.click()';
      return `await (async () => { const primary = page.getByRole('combobox', { name: ${qName} })${first}; if (await primary.count()) { await primary${click}; return; } const comboByText = page.locator('button[role="combobox"]').filter({ hasText: ${qName} }).first(); if (await comboByText.count()) { await comboByText${click}; return; } const buttonByText = page.locator('button').filter({ hasText: ${qName} }).first(); if (await buttonByText.count()) { await buttonByText${click}; return; } await page.getByText(${qName}, { exact: true }).first()${click}; })();`;
    },
  );
}
