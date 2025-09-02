import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('/api/result/delete delete result', async ({ request }) => {
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
  const resultID = resBody.data?.resultID ?? resBody.results?.[0]?.resultID;
  expect(newResult.status()).toBe(200);

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
