import { expect } from '@playwright/test';
import { test } from './fixture/base';

test('Verify success upload result', async ({ app }) => {
  await app.result.navigateTo();
  await app.result.verifyPageElementsVisible();
  await app.result.uploadResult();
  await app.result.verifyResultData('UI', 'tag: e2e');
});

test('Verify success generated report', async ({ app }) => {
  await app.result.navigateTo();
  await app.result.selectResult();
  await app.result.verifySelectionCount();
  await app.result.generateReport('UI', 'e2e UI');
  await app.result.openReportPage();
  await app.report.verifyReportData('e2e UI', 'UI');
});
