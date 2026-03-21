import assert from 'node:assert/strict';
import {
  escapeLocatorCssInPlaywrightSnippet,
  escapeTailwindColonsInCssSelector,
} from './playback-css-escape.util';

const userCase =
  "a.flex.items-center.gap-3.rounded-lg.px-3.py-2.text-lg.font-medium.transition-colors.text-muted-foreground.hover:bg-accent.hover:text-foreground";
const fixed = escapeTailwindColonsInCssSelector(userCase);
assert.ok(fixed.includes('hover\\:bg-accent'), fixed);
assert.ok(fixed.includes('hover\\:text-foreground'), fixed);

assert.equal(
  escapeTailwindColonsInCssSelector('div.foo:hover'),
  'div.foo:hover',
  'real :hover pseudo must not be escaped',
);

assert.equal(
  escapeTailwindColonsInCssSelector('div.item:first-child'),
  'div.item:first-child',
  ':first-child must not be escaped',
);

const snippet = `await page.locator('${userCase}').click();`;
const outSnippet = escapeLocatorCssInPlaywrightSnippet(snippet);
assert.ok(outSnippet.includes('hover\\:bg-accent'), outSnippet);

console.log('playback-css-escape.selftest: ok');
