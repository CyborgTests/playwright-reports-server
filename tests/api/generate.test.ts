import { expect } from '@playwright/test';
import { test } from './fixtures/base';
import { ResultController } from './controllers/ResultController';

test('/api/result/upload should accept correct zip blob', async ({ uploadedResult }) => {
  const { resp, json } = uploadedResult;
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

test('/api/result/upload without file should fail', async ({ request }) => {
  const resp = await request.put('/api/result/upload', {
    multipart: { project: 'Smoke', tag: 'no-file' },
  });
  expect(resp.status()).toBe(400);
  const body = await resp.json();
  expect(body.error).toBe('upload result failed: No file received');
});

test('/api/report/generate with invalid result id should fail', async ({ request, uploadedResult }) => {
  const { json } = uploadedResult;
  const project = json.data?.project;
  const newReport = await request.post('/api/report/generate', {
    data: {
      project,
      resultsIds: '435453434343',
    },
  });

  expect(newReport.status()).toBe(404);
});

test('/api/report/list filter by Project', async ({ request }) => {
  const api = new ResultController(request);
  const { response, json } = await api.list({ project: 'Smoke', limit: 100 });
  expect(response.status()).toBe(200);
  for (const response of json.results) expect(response.project).toBe('Smoke');
});

test('/api/report/list filter by Tag', async ({ request }) => {
  const api = new ResultController(request);
  const { response, json } = await api.list({ tags: 'tag: api-smoke', limit: 100 });
  expect(response.status()).toBe(200);
  for (const response of json.results) expect(response.tag).toBe('api-smoke');
});

test('/api/report/list page per row return proper data count', async ({ request }) => {
  const api = new ResultController(request);
  const limits = [10, 20, 50];
  for (const limit of limits) {
    const { response, json } = await api.list({ limit });
    expect(response.status()).toBe(200);
    expect((json.results ?? []).length).toBeLessThanOrEqual(limit);
  }
});

test('/api/report/list search retrun valid data by existing reportId', async ({ request, uploadedResult }) => {
  const { json } = uploadedResult;
  const resultID = json.data?.resultID;
  const api = new ResultController(request);
  const { response } = await api.list({ search: resultID });
  expect(response.status()).toBe(200);
  expect(resultID).toBeTruthy();
});
