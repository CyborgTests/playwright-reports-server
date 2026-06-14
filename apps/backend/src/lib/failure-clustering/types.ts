import type { TestRun } from '../service/db/index.js';

export type { FixturePhase } from '@playwright-reports/shared';

export const FAILED_OUTCOMES = new Set(['unexpected', 'failed', 'flaky']);

export type FailedTestRun = TestRun;

export interface TestMeta {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
}

export type TestKey = string;

export const testKey = (testId: string, fileId: string, project: string): TestKey =>
  `${project}::${fileId}::${testId}`;
