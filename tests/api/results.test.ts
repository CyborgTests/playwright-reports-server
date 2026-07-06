import { expect } from '@playwright/test';
import { ResultController } from './controllers/result.controller';
import { test } from './fixtures/base';

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

test('/api/result/list filter by Project', async ({ request }) => {
  const api = new ResultController(request);
  const { response, json } = await api.list({ project: 'Smoke', limit: 100 });
  expect(response.status()).toBe(200);
  for (const response of json.results) expect(response.project).toBe('Smoke');
});

test('/api/result/list filter by Tag', async ({ request }) => {
  const api = new ResultController(request);
  const { response, json } = await api.list({ tags: 'tag: api-smoke', limit: 100 });
  expect(response.status()).toBe(200);
  for (const response of json.results) expect(response.tag).toBe('api-smoke');
});

test('/api/result/list page per row return proper data count', async ({ request }) => {
  const api = new ResultController(request);
  const limits = [10, 20, 50];
  for (const limit of limits) {
    const { response, json } = await api.list({ limit });
    expect(response.status()).toBe(200);
    expect((json.results ?? []).length).toBeLessThanOrEqual(limit);
  }
});

test('/api/result/list search return valid data by existing resultID', async ({
  request,
  uploadedResult,
}) => {
  const resultID = uploadedResult.body.data.resultID;
  const api = new ResultController(request);
  const { response, json } = await api.list({ search: resultID });
  expect(response.status()).toBe(200);
  expect(json.results.map((r: any) => r.resultID)).toContain(resultID);
});

test('/api/result/list search return No Result by not existing resultID', async ({ request }) => {
  const resultID = 'еуіе45789';
  const api = new ResultController(request);
  const { response, json } = await api.list({ search: resultID });
  expect(response.status()).toBe(200);
  expect(json).toEqual({ results: [], total: 0 });
});
