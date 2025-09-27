import { expect } from '@playwright/test';
import { test } from './fixtures/base';
import { ResultController } from './controllers/ResultController';

test('/api/result/upload should accept correct zip blob', async ({ request }) => {
  const resultController = new ResultController(request);

  const { resp, json } = await resultController.upload({
    filePath: './tests/testdata/blob.zip',
    project: 'Smoke',
    tag: 'api-smoke',
  });
  expect(resp.status()).toBe(200);
  expect(json.message).toBe('Success');

  expect(json.data).toHaveProperty('resultID');
  expect(json.data).toHaveProperty('createdAt');
  expect(json.data.project).toBe('Smoke');
  expect(json.data).toHaveProperty('size');
  expect(json.data).toHaveProperty('sizeBytes');
  expect(json.data).toHaveProperty('generatedReport');
});

test('/api/result/list shows result list', async ({ request }) => {
  const resultList = await request.get('/api/result/list');
  expect(resultList.status()).toBe(200);
  const body = await resultList.json();
  expect(body).toHaveProperty('results');
  expect(body).toHaveProperty('total');

  if (body.results.length > 0) {
    const result = body.results[0];
    expect(result).toHaveProperty('resultID');
    expect(result).toHaveProperty('createdAt');
    expect(result).toHaveProperty('size');
    expect(result).toHaveProperty('project');
  }
});

test('/api/report/generate should generate report', async ({ request, uploadedResult }) => {
  const { json } = uploadedResult;
  const project = json.data?.project;
  const resultID = json.data?.resultID;
  const newReport = await request.post('/api/report/generate', {
    data: {
      project,
      resultsIds: [resultID],
    },
  });

  const repBody = await newReport.json();

  expect(newReport.status()).toBe(200);
  expect(repBody.reportId).toBeTruthy();
  expect(repBody.reportUrl).toContain(`/api/serve/${project}/${repBody.reportId}/`);
  expect(repBody.project ?? repBody.metadata?.project).toBe(project);
});

test('/api/report/list shows report list', async ({ request }) => {
  const reportList = await request.get('/api/report/list');
  expect(reportList.status()).toBe(200);
  const body = await reportList.json();
  expect(body).toHaveProperty('reports');
  expect(body).toHaveProperty('total');

  if (body.reports.length > 0) {
    const reports = body.reports[0];
    expect(reports).toHaveProperty('reportID');
    expect(reports).toHaveProperty('createdAt');
    expect(reports).toHaveProperty('project');
    expect(reports).toHaveProperty('size');
    expect(reports).toHaveProperty('reportUrl');
  }
});
