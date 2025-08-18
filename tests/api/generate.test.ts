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
