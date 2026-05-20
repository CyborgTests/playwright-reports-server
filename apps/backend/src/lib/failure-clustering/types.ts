import type { FailureCluster } from '@playwright-reports/shared';
import type { TestRun } from '../service/db/tests.sqlite.js';

export type { FixturePhase } from '@playwright-reports/shared';

export const FAILED_OUTCOMES = new Set(['unexpected', 'failed', 'flaky']);

export interface FailedTestRun extends TestRun {
  errorSignatureGlobal: string;
}

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

/** Each strategy emits clusters along with the runs that belong to them, so
 *  index.ts can build per-test metadata without re-deriving membership. */
export interface ClusterWithRuns {
  cluster: FailureCluster;
  runs: FailedTestRun[];
}
