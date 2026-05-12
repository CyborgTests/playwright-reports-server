import { expect } from '@playwright/test';
import { test } from './fixtures/base';
import { ResultController } from './controllers/result.controller';

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

test('/api/result/list search return valid data by existing resultID', async ({ request, uploadedResult }) => {
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

test('/api/result/list filter by date range returns items within range', async ({ request, uploadedResult }) => {
  const api = new ResultController(request);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { response, json } = await api.list({ dateFrom: yesterday, dateTo: tomorrow });
  expect(response.status()).toBe(200);
  expect(json.results.length).toBeGreaterThan(0);
  expect(json.results.some((r: any) => r.resultID === uploadedResult.body.data?.resultID)).toBeTruthy();
});

test('/api/result/list filter by future date range returns empty list', async ({ request }) => {
  const api = new ResultController(request);
  const futureFrom = '2099-01-01T00:00:00.000Z';
  const futureTo = '2099-12-31T23:59:59.999Z';

  const { response, json } = await api.list({ dateFrom: futureFrom, dateTo: futureTo });
  expect(response.status()).toBe(200);
  expect(json.results).toEqual([]);
  expect(json.total).toBe(0);
});

test('/api/result/list filter by dateFrom only returns items from that date onwards', async ({ request, uploadedResult }) => {
  const api = new ResultController(request);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { response, json } = await api.list({ dateFrom: yesterday, limit: 1000 });
  expect(response.status()).toBe(200);
  expect(json.results.length).toBeGreaterThan(0);
  expect(json.results.some((r: any) => r.resultID === uploadedResult.body.data?.resultID)).toBeTruthy();
});

test('/api/result/list filter by dateTo only returns items up to that date', async ({ request, uploadedResult }) => {
  const api = new ResultController(request);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { response, json } = await api.list({ dateTo: tomorrow, limit: 1000 });
  expect(response.status()).toBe(200);
  expect(json.results.length).toBeGreaterThan(0);
  expect(json.results.some((r: any) => r.resultID === uploadedResult.body.data?.resultID)).toBeTruthy();
});
