import { expect } from '@playwright/test';
import { test } from './fixtures/base';
import { ReportController } from './controllers/report.controller';

test('/api/report/list shows report list', async ({ request }) => {
  const reportList = await request.get('/api/report/list');
  expect(reportList.status()).toBe(200);
  const body = await reportList.json();
  expect(body).toHaveProperty('reports');
  expect(body).toHaveProperty('total');

  if (body.reports.length > 0) {
    const reports = body.reports[0];
    expect(reports).toHaveProperty('reportID');
    expect(reports).toHaveProperty('createdAt');
    expect(reports).toHaveProperty('project');
    expect(reports).toHaveProperty('size');
    expect(reports).toHaveProperty('reportUrl');
  }
});

test('/api/report/list filter by Project', async ({ request }) => {
  const api = new ReportController(request);
  const { response, json } = await api.list({ project: 'Smoke', limit: 100 });
  expect(response.status()).toBe(200);
  for (const response of json.reports) expect(response.project).toBe('Smoke');
});

test('/api/report/list page per row return proper data count', async ({ request }) => {
  const api = new ReportController(request);
  const limits = [10, 20, 50];
  for (const limit of limits) {
    const { response, json } = await api.list({ limit });
    expect(response.status()).toBe(200);
    expect((json.report ?? []).length).toBeLessThanOrEqual(limit);
  }
});

test('/api/report/list search return valid data by existing reportId', async ({ request, generatedReport }) => {
  const title = generatedReport.body.metadata?.title;
  const api = new ReportController(request);
  const { response, json } = await api.list({ search: title });
  expect(response.status()).toBe(200);
  expect(json.reports.map((r: any) => r.title)).toContain(title);
});

test('/api/report/list search return No Result  by not existing reportId', async ({ request }) => {
  const title = 'еуіе';
  const api = new ReportController(request);
  const { response, json } = await api.list({ search: title });
  expect(response.status()).toBe(200);
  expect(json).toEqual({ reports: [], total: 0 });
});
