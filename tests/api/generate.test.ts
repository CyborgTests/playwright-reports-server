import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('/api/result/upload should accept correct zip blob', async ({ request }) => {
  const filePath = path.resolve(process.cwd(), './tests/testdata/blob.zip');
  const zip = await readFile(filePath);
  const newResult = await request.put('/api/result/upload', {
    multipart: {
      file: { name: 'blob.zip', mimeType: 'application/zip', buffer: zip },
      project: 'Smoke',
      tag: 'api-smoke',
    },
  });
  expect(newResult.status()).toBe(200);

  const body = await newResult.json();
  expect(body.message).toBe('Success');
  expect(body.data).toHaveProperty('resultID');
  expect(body.data).toHaveProperty('createdAt');
  expect(body.data.project).toBe('Smoke');
  expect(body.data).toHaveProperty('size');
  expect(body.data).toHaveProperty('sizeBytes');
  expect(body.data).toHaveProperty('generatedReport');
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

test('/api/report/generate should generate report', async ({ request }) => {
  const filePath = path.resolve(process.cwd(), './tests/testdata/blob.zip');
  const zip = await readFile(filePath);
  const newResult = await request.put('/api/result/upload', {
    multipart: {
      file: { name: 'blob.zip', mimeType: 'application/zip', buffer: zip },
      project: 'Smoke',
      tag: 'api-smoke',
    },
  });

  const resBody = await newResult.json();
  const project = resBody.data?.project ?? resBody.results?.[0]?.project;
  const resultID = resBody.data?.resultID ?? resBody.results?.[0]?.resultID;
  expect(project).toBeTruthy();
  expect(resultID).toBeTruthy();

  const newReport = await request.post('/api/report/generate', {
    data: {
      project: project,
      resultsIds: [resultID],
    },
  });

  const repBody = await newReport.json();
  const projectReport = repBody.project ?? repBody.metadata?.project;

  expect(newReport.status()).toBe(200);
  expect(repBody.reportId).toBeTruthy();
  expect(repBody.reportUrl).toContain(`/api/serve/${project}/${repBody.reportId}/`);
  expect(projectReport).toBe(project);
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
