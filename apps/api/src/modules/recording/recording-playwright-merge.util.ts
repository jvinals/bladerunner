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
