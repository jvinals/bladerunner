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
const jsonArg = outSnippet.match(/\.locator\(\s*("(?:\\.|[^"\\])*")\s*\)/)?.[1];
assert.ok(jsonArg, `expected JSON-stringified locator arg, got: ${outSnippet.slice(0, 200)}`);
const decoded = JSON.parse(jsonArg) as string;
assert.ok(decoded.includes('hover\\:bg-accent'), decoded);
assert.ok(decoded.includes('hover\\:text-foreground'), decoded);

const nestedQuoteSnippet =
  "await page.locator('button.inline-flex.items-center.[&_svg:not([class*=\\\\'size-\\\\'])]:size-4').click();";
const nestedQuoteOut = escapeLocatorCssInPlaywrightSnippet(nestedQuoteSnippet);
assert.ok(nestedQuoteOut.includes('.locator("'), nestedQuoteOut);
assert.ok(!nestedQuoteOut.includes(".locator('"), nestedQuoteOut);
assert.doesNotThrow(
  () => new Function('page', 'return (async () => { ' + nestedQuoteOut + ' })();'),
  nestedQuoteOut,
);

const fileInputSnippet =
  "await page.locator('input.file:text-foreground.selection:bg-primary.dark:bg-input/30.transition-[color,box-shadow].file:inline-flex.!border-0').click();";
const fileInputOut = escapeLocatorCssInPlaywrightSnippet(fileInputSnippet);
const fileInputJsonArg = fileInputOut.match(/\.locator\(\s*("(?:\\.|[^"\\])*")\s*\)/)?.[1];
assert.ok(fileInputJsonArg, `expected escaped file input locator arg, got: ${fileInputOut.slice(0, 240)}`);
const fileInputDecoded = JSON.parse(fileInputJsonArg) as string;
assert.ok(fileInputDecoded.includes('file\\:text-foreground'), fileInputDecoded);
assert.ok(fileInputDecoded.includes('dark\\:bg-input\\/30'), fileInputDecoded);
assert.ok(fileInputDecoded.includes('transition-\\[color\\,box-shadow\\]'), fileInputDecoded);
assert.ok(fileInputDecoded.includes('\\!border-0'), fileInputDecoded);

console.log('playback-css-escape.selftest: ok');
