import { expect } from '@playwright/test';
import { test } from './fixtures/base';

// Run tests serially to avoid race conditions in report generation
test.describe.serial('Report export and download', () => {
  test('/api/report/[id]/export returns ZIP with correct headers', async ({ request, generatedReport }) => {
    const reportId = generatedReport.body.reportId;
    const response = await request.get(`/api/report/${reportId}/export?format=zip`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/zip');
    expect(response.headers()['content-disposition']).toContain('.zip');
  });

  test('/api/report/[id]/export returns 400 for unknown format', async ({ request, generatedReport }) => {
    const reportId = generatedReport.body.reportId;
    const response = await request.get(`/api/report/${reportId}/export?format=invalid`);

    expect(response.status()).toBe(400);
  });

  test('/api/report/[id]/export returns 404 for non-existent report ID', async ({ request }) => {
    const response = await request.get(`/api/report/nonexistent123/export?format=zip`);

    expect(response.status()).toBe(404);
  });

  test('/api/download/[id] returns ZIP with correct headers', async ({ request, generatedReport }) => {
    const reportId = generatedReport.body.reportId;
    const response = await request.get(`/api/download/${reportId}?format=zip`);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/zip');
    expect(response.headers()['content-disposition']).toContain('.zip');
  });

  test('/api/download/[id] returns 400 for unknown format', async ({ request, generatedReport }) => {
    const reportId = generatedReport.body.reportId;
    const response = await request.get(`/api/download/${reportId}?format=invalid`);

    expect(response.status()).toBe(400);
  });

  test('/api/download/[id] returns 404 for non-existent report ID', async ({ request }) => {
    const response = await request.get(`/api/download/nonexistent123?format=zip`);

    expect(response.status()).toBe(404);
  });
});
