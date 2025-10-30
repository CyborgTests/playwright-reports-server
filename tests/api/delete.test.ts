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
