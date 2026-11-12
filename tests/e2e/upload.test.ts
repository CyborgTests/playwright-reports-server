import { expect } from '@playwright/test';
import { test } from '../src/fixtures/base';

test('User can see result in table', async ({ uploadedResult, page }) => {
    await page.goto('/results');
    await expect(page.getByText(uploadedResult.body.data.resultID)).toBeVisible();
});