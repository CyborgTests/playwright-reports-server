import { expect } from '@playwright/test';
import { test } from './fixture/base';

test('Verify generate report', async ({ app }) => {
  await app.result.navigateTo();
  await app.result.openResult();
  await app.result.verifyPageElements();
  await app.result.uploadResult();
});
// test('Verify generate report', async ({ app }) => {
//   await page.getByRole('link', { name: '83' }).click();
//   await page.getByRole('button', { name: 'Upload Results' }).click();
//   await page.getByRole('button', { name: 'Show suggestions' }).nth(1).click();
//   await page.getByRole('option', { name: 'Smoke' }).click();
//   await page.locator('div').filter({ hasText: /^Add$/ }).click();
//   await page.getByRole('textbox', { name: 'Enter tag (e.g., \'key:value\'' }).click();
//   await page.getByRole('textbox', { name: 'Enter tag (e.g., \'key:value\'' }).fill('snoke-test');
//   await page.getByRole('button', { name: 'Choose file (.zip, .json)' }).click();
//   await page.getByRole('button', { name: 'Choose file (.zip, .json)' }).click();
//   await page.getByRole('button', { name: 'Choose file (.zip, .json)' }).setInputFiles('correct_blob.zip');
//   await page.getByRole('button', { name: 'Upload' }).click();
//   await page.getByText('Results uploaded successfully').click();
//   await page.getByText('Results uploaded successfully').click();
//   await expect(page.getByText('Results uploaded successfully')).toBeVisible();
//   await expect(page.getByText('b7bc4c5c-4c3d-4f8c-a0e9-')).toBeVisible();
//   await expect(page.locator('[id="react-aria6900401893-:rc3:"]').getByText('Smoke')).toBeVisible();
// });
