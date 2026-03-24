/**
 * Self-test: `pnpm --filter @bladerunner/api exec tsx src/modules/llm/gemini-instruction.selftest.ts`
 */
import assert from 'node:assert/strict';
import {
  buildGeminiInstructionPrompt,
  GEMINI_DOM_A11Y_MAX_CHARS,
  GEMINI_DOM_SOM_MAX_CHARS,
  truncateDomSectionsForGemini,
} from './gemini-instruction.client';

const long = 'x'.repeat(GEMINI_DOM_SOM_MAX_CHARS + 500);
const a11y = 'y'.repeat(GEMINI_DOM_A11Y_MAX_CHARS + 500);
const { som, a11y: aOut } = truncateDomSectionsForGemini(long, a11y);
assert.ok(som.includes('[SOM manifest truncated]'));
assert.ok(aOut.includes('[accessibility snapshot truncated]'));
assert.ok(som.length < long.length);
assert.ok(aOut.length < a11y.length);

const prompt = buildGeminiInstructionPrompt({
  instruction: 'Click Save',
  pageUrl: 'https://example.com/app',
  somManifest: '[1] <button> name="Save"',
  accessibilitySnapshot: '{"role":"Root"}',
});
assert.ok(prompt.includes('Click Save'));
assert.ok(prompt.includes('https://example.com/app'));
assert.ok(prompt.includes('[1] <button>'));
assert.ok(prompt.includes('{"role":"Root"}'));
assert.ok(prompt.includes('Playwright CDP accessibility snapshot'));

const emptySom = buildGeminiInstructionPrompt({
  instruction: 't',
  pageUrl: 'u',
  somManifest: '',
  accessibilitySnapshot: '{}',
});
assert.ok(emptySom.includes('(none)'));

console.log('gemini-instruction.selftest: ok');
