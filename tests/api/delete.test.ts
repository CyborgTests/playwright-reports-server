import { test, expect } from '@playwright/test';
import { ResultController } from './controllers/ResultController';

test('/api/result/delete delete result', async ({ request }) => {
  const resultController = new ResultController(request);
  const { resp, json } = await resultController.upload({
    filePath: './tests/testdata/blob.zip',
    project: 'Smoke',
    tag: 'api-smoke',
  });
  expect(resp.status()).toBe(200);
  expect(json.data?.resultID).toBeTruthy();

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

test('/api/report/delete delete report', async ({ request }) => {
  const resultController = new ResultController(request);
  const { resp, json } = await resultController.upload({
    filePath: './tests/testdata/blob.zip',
    project: 'Smoke',
    tag: 'api-smoke',
  });
  const project = json.data?.project;
  const resultID = json.data?.resultID;

  const newReport = await request.post('/api/report/generate', {
    data: {
      project: project,
      resultsIds: [resultID],
    },
  });

  const repBody = await newReport.json();
  const reportId = repBody.reportId;

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
