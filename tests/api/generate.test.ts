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

  const reportBody = await newReport.json();
  const projectReport = reportBody.project ?? reportBody.metadata?.project;
  console.log(reportBody);

  expect(newReport.status()).toBe(200);
  expect(reportBody.reportId).toBeTruthy();
  expect(reportBody.reportUrl).toContain(`/api/serve/${project}/${reportBody.reportId}/`);
  expect(projectReport).toBe(project);

});