import { expect } from '@playwright/test';
import { test } from './fixtures/base';

test('/api/result/delete delete result', async ({ request, uploadedResult }) => {
  const { body } = uploadedResult;

  const resultID = body.data.resultID;

  const deleteRes = await request.delete('/api/result/delete', {
    data: {
      resultsIds: [resultID],
    },
  });

  expect(deleteRes.status()).toBe(200);
  const deleteBody = await deleteRes.json();

  expect(deleteBody.message).toContain('Results files deleted successfully');
  expect(deleteBody.resultsIds).toContain(resultID);
});

test('/api/report/delete delete report', async ({ request, generatedReport }) => {
  const { body } = generatedReport;
  const reportId = body.reportId;
  const deleteReport = await request.delete('/api/report/delete', {
    data: {
      reportsIds: [reportId],
    },
  });

  expect(deleteReport.status()).toBe(200);
  const deleteBody = await deleteReport.json();

  expect(deleteBody.message).toContain('Reports deleted successfully');
  expect(deleteBody.reportsIds).toContain(reportId);
});

test('/api/report/delete bulk delete multiple reports', async ({ request, uploadedResult }) => {
  // Generate two reports
  const resultId = uploadedResult.body.data?.resultID!;
  const report1 = await request.post('/api/report/generate', {
    data: {
      resultsIds: [resultId],
      project: 'BulkDeleteTest',
      title: 'Bulk Delete Test 1',
    },
  });

  expect(report1.ok()).toBeTruthy();
  const genBody1 = await report1.json();
  const reportId1 = genBody1.reportId;

  const report2 = await request.post('/api/report/generate', {
    data: {
      resultsIds: [resultId],
      project: 'BulkDeleteTest',
      title: 'Bulk Delete Test 2',
    },
  });

  expect(report2.ok()).toBeTruthy();
  const genBody2 = await report2.json();
  const reportId2 = genBody2.reportId;

  // Delete both reports in a single call
  const deleteRes = await request.delete('/api/report/delete', {
    data: {
      reportsIds: [reportId1, reportId2],
    },
  });

  expect(deleteRes.status()).toBe(200);
  const deleteBody = await deleteRes.json();

  expect(deleteBody.message).toContain('Reports deleted successfully');
  expect(deleteBody.reportsIds).toContain(reportId1);
  expect(deleteBody.reportsIds).toContain(reportId2);

  // Verify both reports are gone from the list
  const listRes = await request.get('/api/report/list?project=BulkDeleteTest');
  expect(listRes.status()).toBe(200);
  const listBody = await listRes.json();

  expect(listBody.reports.some((r: any) => r.reportID === reportId1)).toBeFalsy();
  expect(listBody.reports.some((r: any) => r.reportID === reportId2)).toBeFalsy();
});
