import { test, expect, FullConfig } from '@playwright/test';
import ReporterPlaywrightReportsServer, { ReporterOptions } from '..';

// TODO: Tests should be rewritten

test.skip('url should be required', async () => {
  let noError = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new ReporterPlaywrightReportsServer({} as any);
    noError = true;
  } catch (err) {
    expect((err as Error).message).toContain(
      '[ReporterPlaywrightReportsServer] url is required, cannot run without it',
    );
  }
  expect(noError).toBeFalsy();
});

test.skip('onEnd should throw if no blobPath defined', async () => {
  const reporter = new ReporterPlaywrightReportsServer({
    url: 'test',
    reportPath: 'test',
  } as ReporterOptions);

  let noError = false;
  try {
    await reporter.onEnd();
    noError = true;
  } catch (err) {
    expect((err as Error).message).toContain(
      '[ReporterPlaywrightReportsServer] Blob file path is absent. Results cannot be uploaded',
    );
  }
  expect(noError).toBeFalsy();
});

test.skip('Report should upload if resultDetails has undefined value', async () => {
  const reporter = new ReporterPlaywrightReportsServer({
    url: 'test',
    // blobPath: 'tests/results.zip',
    reportPath: 'tests/report.zip',
    resultDetails: {
      foo: 'undefined',
      bar: 'barValue',
    },
  });

  let noError = false;
  try {
    await reporter.onBegin({} as FullConfig);
    await reporter.onEnd();
    noError = true;
  } catch (err) {
    expect((err as Error).message).toContain('[ReporterPlaywrightReportsServer] blob result uploaded:');
    expect((err as Error).message).toContain("foo: ''");
    expect((err as Error).message).toContain('bar: barValue');
  }
  expect(noError).toBeTruthy();
});

test.skip('should generate report after all shards completed', async () => {
  // TODO: Implement this test
});
