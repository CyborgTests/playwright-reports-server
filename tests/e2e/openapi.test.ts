import { expect } from '@playwright/test';
import { test } from '../src/fixtures/base';

test('OpenAPI documentation page displays the API and a documented endpoint', async ({ page }) => {
  await page.goto('/documentation');

  await expect(page.getByRole('heading', { name: /Playwright Reports Server API/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '/api/tests' })).toBeVisible();
});