import { preferRecordedCssSelectorForBarePageLocator } from './recording-playwright-merge.util';

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

console.log('recording-playwright-merge.selftest: ok');
