import assert from 'node:assert/strict';
import {
  buildPlaybackRepairMetadataPatch,
  isAiPromptSentinelPlaywrightCode,
  isExecutableStoredPlaywrightCode,
  resolveRecordedPlaywrightCode,
} from './recorded-playwright.util';

const sentinel = '/* ai_prompt_step: execution uses LLM + screenshot at playback; do not replay as fixed codegen */';

assert.equal(isAiPromptSentinelPlaywrightCode(sentinel), true);
assert.equal(isExecutableStoredPlaywrightCode(sentinel), false);
assert.equal(isExecutableStoredPlaywrightCode(`await page.getByRole('button').click();`), true);

assert.equal(
  resolveRecordedPlaywrightCode(null, `await page.getByRole('button', { name: 'Save' }).click();`, `await page.getByText('Save').click();`),
  `await page.getByRole('button', { name: 'Save' }).click();`,
);

assert.equal(
  resolveRecordedPlaywrightCode(sentinel, sentinel, `await page.getByText('Provider').click();`),
  `await page.getByText('Provider').click();`,
);

assert.equal(
  resolveRecordedPlaywrightCode(
    `await page.getByRole('button', { name: 'Original' }).click();`,
    `await page.getByRole('button', { name: 'Broken' }).click();`,
    `await page.getByText('Fixed').click();`,
  ),
  `await page.getByRole('button', { name: 'Original' }).click();`,
);

assert.deepEqual(
  buildPlaybackRepairMetadataPatch(
    { prior: true },
    {
      failureAt: '2026-03-25T00:00:00.000Z',
      failureKind: 'timeout',
      failureMessage: 'locator.click timeout',
      failedPlaywrightCode: `await page.getByRole('button', { name: 'Broken' }).click();`,
      generatedPlaywrightCode: `await page.getByText('Fixed').click();`,
      recordedPlaywrightCode: `await page.getByRole('button', { name: 'Original' }).click();`,
      promotedAt: '2026-03-25T00:00:05.000Z',
    },
  ),
  {
    prior: true,
    lastPlaybackRepairAt: '2026-03-25T00:00:00.000Z',
    lastPlaybackRepairFailureKind: 'timeout',
    lastPlaybackRepairFailureMessage: 'locator.click timeout',
    lastPlaybackRepairFailedPlaywrightCode: `await page.getByRole('button', { name: 'Broken' }).click();`,
    lastPlaybackRepairGeneratedPlaywrightCode: `await page.getByText('Fixed').click();`,
    lastPlaybackRepairRecordedPlaywrightCode: `await page.getByRole('button', { name: 'Original' }).click();`,
    lastPlaybackRepairPromotedAt: '2026-03-25T00:00:05.000Z',
  },
);

console.log('recorded-playwright.selftest: ok');
