import { expect } from '@playwright/test';
import { test } from './fixtures/base';

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

test('/api/result/upload without file should fail', async ({ request }) => {
  const resp = await request.put('/api/result/upload', {
    multipart: { project: 'Smoke', tag: 'no-file' },
  });
  expect(resp.status()).toBe(400);
  const body = await resp.json();
  expect(body.error).toBe('upload result failed: No file received');
});
