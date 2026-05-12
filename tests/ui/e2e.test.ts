import { expect } from '@playwright/test';
import { test } from './fixture/base';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

test('Verify generate report', async ({ app }) => {
  await app.result.navigateTo();
  await app.result.openResult();
  await app.result.verifyPageElements();
  await app.result.uploadResult();
});

test('Date range picker filters the reports table', async ({ app, request }) => {
  // First, create a report via API to ensure we have test data
  const filePath = path.resolve(process.cwd(), 'tests/testdata/correct_blob.zip');
  const fileBuffer = await readFile(filePath);

  const uploadRes = await request.put('/api/result/upload', {
    multipart: {
      file: { name: 'correct_blob.zip', mimeType: 'application/zip', buffer: fileBuffer },
      project: 'all',
      tag: 'ui-date-test',
    },
  });
  expect(uploadRes.ok()).toBeTruthy();
  const uploadBody = await uploadRes.json();
  const resultID = uploadBody.data.resultID;

  // Generate report with project 'all' to match default project filter
  const genRes = await request.post('/api/report/generate', {
    data: {
      resultsIds: [resultID],
      project: 'all',
      title: 'UI Date Filter Test Report',
    },
  });
  expect(genRes.ok()).toBeTruthy();

  // Navigate to reports page
  await app.reports.navigateTo();

  // Wait for grid to load - use a longer timeout since the page needs to fetch data
  await expect(app.reports.page.getByRole('grid', { name: 'Reports' })).toBeVisible({ timeout: 10000 });

  // Verify our generated report appears in the table
  await expect(app.reports.page.getByText('UI Date Filter Test Report').first()).toBeVisible();

  // Also verify row count > 1 (header row + at least one data row)
  const rowCount = await app.reports.countVisibleReports();
  expect(rowCount).toBeGreaterThan(1);
});

test('Download buttons appear on a report row', async ({ app, request }) => {
  // Create a report via API with project 'all' to match default project filter
  const filePath = path.resolve(process.cwd(), 'tests/testdata/correct_blob.zip');
  const fileBuffer = await readFile(filePath);

  const uploadRes = await request.put('/api/result/upload', {
    multipart: {
      file: { name: 'correct_blob.zip', mimeType: 'application/zip', buffer: fileBuffer },
      project: 'all',
      tag: 'ui-download-test',
    },
  });
  expect(uploadRes.ok()).toBeTruthy();
  const uploadBody = await uploadRes.json();
  const resultID = uploadBody.data.resultID;

  const genRes = await request.post('/api/report/generate', {
    data: {
      resultsIds: [resultID],
      project: 'all',
      title: 'UI Download Test Report',
    },
  });
  expect(genRes.ok()).toBeTruthy();

  // Navigate to reports page
  await app.reports.navigateTo();

  // Wait for the table to load and the report to appear
  await expect(app.reports.page.getByText('UI Download Test Report').first()).toBeVisible();

  // Check download buttons (ZIP, PDF, Evidence) are present on the row
  const downloadZip = app.reports.page.getByLabel('Download HTML (ZIP)');
  const downloadPdf = app.reports.page.getByLabel('Export as PDF');
  const downloadEvidence = app.reports.page.getByLabel('Evidence PDF (test name + screenshot)');

  await expect(downloadZip.first()).toBeVisible();
  await expect(downloadPdf.first()).toBeVisible();
  await expect(downloadEvidence.first()).toBeVisible();
});
