import { expect } from '@playwright/test';
import { test } from './fixtures/base';

test('/api/result/upload should accept correct zip blob', async ({ uploadedResult }) => {
  const { response, body } = uploadedResult;
  expect(response.status()).toBe(200);
  expect(body.message).toBe('Success');
  expect(body.data).toHaveProperty('resultID');
  expect(body.data).toHaveProperty('createdAt');
  expect(body.data.project).toBe('Smoke');
  expect(body.data).toHaveProperty('size');
  expect(body.data).toHaveProperty('sizeBytes');
  expect(body.data).toHaveProperty('generatedReport');
});

test('/api/result/upload without file should fail', async ({ request }) => {
  const resp = await request.put('/api/result/upload', {
    multipart: { project: 'Smoke', tag: 'no-file' },
  });
  expect(resp.status()).toBe(400);
  const body = await resp.json();
  expect(body.error).toBe('upload result failed: No file received');
});
