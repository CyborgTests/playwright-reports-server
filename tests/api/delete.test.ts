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
