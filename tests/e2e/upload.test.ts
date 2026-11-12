import { expect } from '@playwright/test';
import { test } from '../src/fixtures/base';
import { FRONTEND_URL } from '../src/environment';

test('User can see result in table', async ({ uploadedResult, page }) => {
    await page.goto(`${FRONTEND_URL}/results`);
    await expect(page.getByText(uploadedResult.body.data.resultID)).toBeVisible();
});