import { randomUUID } from 'node:crypto';
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

test('/api/result/upload passes custom result metadata to the generated report', async ({
  api,
}) => {
  const branch = `branch-${randomUUID()}`;

  const { body } = await api.result.upload('./tests/testdata/correct_blob.zip', {
    project: 'Smoke',
    testRun: randomUUID(),
    branch,
    username: 'metadata-carryover',
    triggerReportGeneration: true,
  });

  const reportId = body.data.generatedReport?.reportId ?? '';
  expect(reportId).toBeTruthy();

  const { json: report } = await api.report.get(reportId);
  expect(report.branch).toBe(branch);
  expect(report.username).toBe('metadata-carryover');
  expect(report.triggerReportGeneration).toBeUndefined();

  const { response, json } = await api.report.list({ tags: `branch:${branch}` });
  expect(response.status()).toBe(200);
  expect(json.reports.map((r: { reportID: string }) => r.reportID)).toContain(reportId);
});

test('/api/result/upload keeps shard-specific fields off the merged report', async ({ api }) => {
  const testRun = randomUUID();
  const branch = `branch-${randomUUID()}`;

  // `runner` is only present on the first shard - the report is generated from
  // the last one, so a field missing there must not break the merge.
  await api.result.upload('./tests/testdata/correct_blob.zip', {
    testRun,
    branch,
    runner: 'shard-one-only',
    shardCurrent: 1,
    shardTotal: 2,
    triggerReportGeneration: true,
  });
  const shard2 = await api.result.upload('./tests/testdata/correct_blob.zip', {
    testRun,
    branch,
    shardCurrent: 2,
    shardTotal: 2,
    triggerReportGeneration: true,
  });

  const reportId = shard2.body.data.generatedReport?.reportId ?? '';
  expect(reportId).toBeTruthy();

  const { json: report } = await api.report.get(reportId);
  expect(report.branch).toBe(branch);
  expect(report.shardCurrent).toBeUndefined();
  expect(report.shardTotal).toBeUndefined();
  expect(report.triggerReportGeneration).toBeUndefined();
});

test('/api/result/upload without file should fail', async ({ request }) => {
  const resp = await request.put('/api/result/upload', {
    multipart: { project: 'Smoke', tag: 'no-file' },
  });
  expect(resp.status()).toBe(400);
  const body = await resp.json();
  expect(body.error).toBe('upload result failed: No file received');
});
