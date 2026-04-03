import {
  excludeFileInputFromFollowingInputXPath,
  fallbackNamedComboboxClicksForPlayback,
  preferGetByTextForBareTagLocator,
  preferRecordedCssSelectorForBarePageLocator,
  preferSearchConditionsPlaceholderOverFollowingInputLabel,
  relaxClickForceForPlayback,
  relaxPageLocatorFirstForPlayback,
  shouldUseExactGetByTextForPlayback,
  stripTypeScriptNonNullAssertionsForPlayback,
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
  'playback tighten: EHR composite row uses exact false (split DOM / bullet)',
  tightenGetByTextLocatorsForPlayback(
    `await page.getByText('Alina Wren 08/28/1985 • 40yo').click();`,
  ),
  `await page.getByText('Alina Wren 08/28/1985 • 40yo', { exact: false }).first().click();`,
);

assertEq(
  'shouldUseExact: short nav label',
  shouldUseExactGetByTextForPlayback('Patients'),
  true,
);
assertEq(
  'shouldUseExact: composite patient row',
  shouldUseExactGetByTextForPlayback('Alina Wren 08/28/1985 • 40yo'),
  false,
);

assertEq(
  'playback tighten: no-op when already .first().click()',
  tightenGetByTextLocatorsForPlayback(
    `await page.getByText('Patients', { exact: true }).first().click();`,
  ),
  `await page.getByText('Patients', { exact: true }).first().click();`,
);

assertEq(
  'playback force: bare .click()',
  relaxClickForceForPlayback(`await page.getByRole('link', { name: 'Patients' }).click();`),
  `await page.getByRole('link', { name: 'Patients' }).click({ force: true });`,
);

assertEq(
  'playback force: leaves .click({ force: true }) unchanged',
  relaxClickForceForPlayback(`await page.locator('button').click({ force: true });`),
  `await page.locator('button').click({ force: true });`,
);

assertEq(
  'playback relax: bare span -> .first()',
  relaxPageLocatorFirstForPlayback(`await page.locator('span').click();`),
  `await page.locator('span').first().click();`,
);

assertEq(
  'playback relax: bare table -> .first()',
  relaxPageLocatorFirstForPlayback(`const t = await page.locator('table').innerText();`),
  `const t = await page.locator('table').first().innerText();`,
);

assertEq(
  'playback relax: svg class chain -> .first()',
  relaxPageLocatorFirstForPlayback(`await page.locator('svg.lucide-triangle-alert').click();`),
  `await page.locator('svg.lucide-triangle-alert').first().click();`,
);

assertEq(
  'playback relax: no-op when already .first()',
  relaxPageLocatorFirstForPlayback(`await page.locator('svg.lucide-triangle-alert').first().click();`),
  `await page.locator('svg.lucide-triangle-alert').first().click();`,
);

assertEq(
  'playback relax: path[d] -> scoped to dialog (not global .first())',
  relaxPageLocatorFirstForPlayback(`await page.locator('path[d="M18 6 6 18"]').click();`),
  `await page.getByRole('dialog').last().locator('path[d="M18 6 6 18"]').first().click();`,
);

assertEq(
  'playback strip: TS non-null assertion before .click',
  stripTypeScriptNonNullAssertionsForPlayback(`await page.locator('button')!.click();`),
  `await page.locator('button').click();`,
);

assertEq(
  'playback strip: chained !. before property',
  stripTypeScriptNonNullAssertionsForPlayback(`await page.getByRole('dialog')!.locator('input')!.fill('x');`),
  `await page.getByRole('dialog').locator('input').fill('x');`,
);

assertEq(
  'playback: Add disease label + following::input -> Search conditions placeholder',
  preferSearchConditionsPlaceholderOverFollowingInputLabel(
    `await page.locator('div, label, p').filter({ hasText: /^Add disease to today's encounter$/ }).locator('xpath=following::input').first().click();`,
  ),
  `await page.getByPlaceholder('Search conditions...').first().click();`,
);

assertEq(
  'playback: following::input excludes type=file',
  excludeFileInputFromFollowingInputXPath(`await page.locator('section').locator('xpath=following::input').fill('x');`),
  `await page.locator('section').locator('xpath=following::input[not(@type="file")]').fill('x');`,
);

assertEq(
  'playback: combobox role/name click gets resilient fallback',
  fallbackNamedComboboxClicksForPlayback(
    `await page.getByRole('combobox', { name: 'Select Provider' }).click();`,
  ),
  `await (async () => { const primary = page.getByRole('combobox', { name: ${JSON.stringify('Select Provider')} }); if (await primary.count()) { await primary.click(); return; } const comboByText = page.locator('button[role="combobox"]').filter({ hasText: ${JSON.stringify('Select Provider')} }).first(); if (await comboByText.count()) { await comboByText.click(); return; } const buttonByText = page.locator('button').filter({ hasText: ${JSON.stringify('Select Provider')} }).first(); if (await buttonByText.count()) { await buttonByText.click(); return; } await page.getByText(${JSON.stringify('Select Provider')}, { exact: true }).first().click(); })();`,
);

console.log('recording-playwright-merge.selftest: ok');
