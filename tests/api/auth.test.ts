import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.describe('Authorization', () => {
  test('returns 200 with correct Authorization header', async ({ playwright }) => {
    const token = process.env.API_TOKEN;
    test.skip(!token, 'API_TOKEN not set — auth tests require a token');

    const ctx = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
      extraHTTPHeaders: { Authorization: token! },
    });
    const response = await ctx.get('/api/result/list');
    await ctx.dispose();

    expect(response.status()).toBe(200);
  });

  test('returns 401 with wrong Authorization header', async ({ playwright }) => {
    const token = process.env.API_TOKEN;
    test.skip(!token, 'API_TOKEN not set — auth tests require a token');

    const ctx = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
      extraHTTPHeaders: { Authorization: `Bearer ${randomUUID()}` },
    });
    const response = await ctx.get('/api/result/list');
    await ctx.dispose();

    expect(response.status()).toBe(401);
  });

  test('returns 401 with no Authorization header', async ({ playwright }) => {
    const token = process.env.API_TOKEN;
    test.skip(!token, 'API_TOKEN not set — auth tests require a token');

    const ctx = await playwright.request.newContext({ baseURL: 'http://localhost:3000' });
    const response = await ctx.get('/api/result/list');
    await ctx.dispose();

    expect(response.status()).toBe(401);
  });
});
