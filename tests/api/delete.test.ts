import { expect } from '@playwright/test';
import { test } from './fixtures/base';
import { ResultController } from './controllers/ResultController';

test('/api/result/delete delete result', async ({ request, uploadedResult }) => {
  const { json } = uploadedResult;
  const resultID = json.data?.resultID;

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
  const { json } = generatedReport;
  const reportId = json.reportId;
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
