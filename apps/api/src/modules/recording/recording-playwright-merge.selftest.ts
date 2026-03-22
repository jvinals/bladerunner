import {
  preferGetByTextForBareTagLocator,
  preferRecordedCssSelectorForBarePageLocator,
  tightenGetByTextLocatorsForPlayback,
} from './recording-playwright-merge.util';

function assertEq<T>(label: string, got: T, want: T) {
  if (got !== want) {
    console.error(`FAIL ${label}:\n  got:  ${String(got)}\n  want: ${String(want)}`);
    process.exit(1);
  }
}

assertEq(
  'bare span -> recorded span.ml-2',
  preferRecordedCssSelectorForBarePageLocator('span.ml-2.text-sm', `await page.locator('span').click();`),
  `await page.locator(${JSON.stringify('span.ml-2.text-sm')}).click();`,
);

assertEq(
  'no-op when already specific',
  preferRecordedCssSelectorForBarePageLocator('td.px-6.py-4', `await page.locator('td.px-6.py-4').click();`),
  `await page.locator('td.px-6.py-4').click();`,
);

assertEq(
  'no-op when tag mismatch',
  preferRecordedCssSelectorForBarePageLocator('a.nav-item', `await page.locator('span').click();`),
  `await page.locator('span').click();`,
);

assertEq(
  'skip getByRole',
  preferRecordedCssSelectorForBarePageLocator('span.x', `await page.getByRole('link', { name: 'Patients' }).click();`),
  `await page.getByRole('link', { name: 'Patients' }).click();`,
);

assertEq(
  'bare span + visible text -> getByText',
  preferGetByTextForBareTagLocator(
    'span',
    'Patients',
    `await page.locator('span').first().click();`,
  ),
  `await page.getByText(${JSON.stringify('Patients')}, { exact: true }).first().click();`,
);

assertEq(
  'playback tighten: exact false -> true + first before click',
  tightenGetByTextLocatorsForPlayback(`await page.getByText('Patients', { exact: false }).click();`),
  `await page.getByText('Patients', { exact: true }).first().click();`,
);

assertEq(
  'playback tighten: bare getByText click',
  tightenGetByTextLocatorsForPlayback(`await page.getByText('Patients').click();`),
  `await page.getByText('Patients', { exact: true }).first().click();`,
);

assertEq(
  'playback tighten: no-op when already .first().click()',
  tightenGetByTextLocatorsForPlayback(
    `await page.getByText('Patients', { exact: true }).first().click();`,
  ),
  `await page.getByText('Patients', { exact: true }).first().click();`,
);

console.log('recording-playwright-merge.selftest: ok');
