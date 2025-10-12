import { expect } from '@playwright/test';
import { test } from './fixture/base';

test('Verify success upload resalt', async ({ app }) => {
  await app.result.navigateTo();
  await app.result.verifyPageElementsVisible();
  await app.result.uploadResult();
  await app.result.verifyResultData('UI', 'tag: e2e');
});
