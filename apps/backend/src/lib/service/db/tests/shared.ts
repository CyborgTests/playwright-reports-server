import type { FailureCategorySource } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { getDatabase } from '../db.js';
import { decodeFailureDetails } from '../failureDetailsCodec.js';
import { getKysely } from '../kysely.js';

export interface Test {
  testId: string;
  fileId: string;
  filePath: string;
  project: string;
  title: string;
  createdAt: string;
  flakinessResetAt?: string;
}

export interface TestRunRow {
  runId: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  outcome: string;
  duration?: number;
  createdAt: string;
  failureDetails?: string;
  failureCategory?: string;
  failureCategorySource?: FailureCategorySource;
  errorSignature?: string;
  reportTitle?: string;
  reportDisplayNumber?: number;
}

export interface TestState {
  flakinessScore: number | null;
  quarantined: number;
  quarantineReason: string | null;
  quarantineFixedAt: string | null;
  latestNonSkippedAt: string | null;
}

export interface TestWithQuarantineInfoRow extends Test {
  isQuarantined?: boolean;
  quarantinedAt?: string;
  quarantineReason?: string;
  flakinessScore?: number;
  flakinessResetAt?: string;
  totalRuns?: number;
  lastRunAt?: string;
  runs?: TestRunRow[];
}

export interface DerivedPageRow {
  testId: string;
  fileId: string;
  filePath: string;
  project: string;
  title: string;
  createdAt: string;
  totalRuns: number;
  lastRunAt: string | null;
  latestOutcome: string | null;
  flakinessScore: number | null;
  quarantined: number;
  latestNonSkippedAt: string | null;
  quarantineReason: string | null;
  recentPassRate: number;
  avgDuration: number | null;
  flakinessResetAt: string | null;
}

export interface TestRunDbRow {
  runId: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  outcome: string;
  duration: number | null;
  createdAt: string;
  failure_details: Buffer | string | null;
  failure_category: string | null;
  failure_category_source: string | null;
  error_signature: string | null;
  reportTitle?: string | null;
  reportDisplayNumber?: number | null;
}

export function convertDbRowToTestRun(row: TestRunDbRow): TestRunRow {
  return {
    runId: row.runId,
    testId: row.testId,
    fileId: row.fileId,
    project: row.project,
    reportId: row.reportId,
    outcome: row.outcome,
    duration: row.duration ?? undefined,
    createdAt: row.createdAt,
    failureDetails: decodeFailureDetails(row.failure_details) || undefined,
    failureCategory: row.failure_category || undefined,
    failureCategorySource: (row.failure_category_source as FailureCategorySource) || undefined,
    errorSignature: row.error_signature || undefined,
    reportTitle: row.reportTitle ?? undefined,
    reportDisplayNumber: row.reportDisplayNumber ?? undefined,
  };
}

export const REFRESH_TEST_STAT_SQL = `
  WITH recent AS (
    SELECT outcome, duration, createdAt
    FROM test_runs
    WHERE testId=:testId AND fileId=:fileId AND project=:project
    ORDER BY createdAt DESC
    LIMIT 50
  ),
  latest_ns AS (
    SELECT createdAt, failure_category
    FROM test_runs
    WHERE testId=:testId AND fileId=:fileId AND project=:project
      AND outcome != 'skipped'
    ORDER BY createdAt DESC
    LIMIT 1
  ),
  totals AS (
    SELECT COUNT(*) AS totalRuns, MAX(createdAt) AS latestRunAt
    FROM test_runs
    WHERE testId=:testId AND fileId=:fileId AND project=:project
  ),
  recent_agg AS (
    SELECT
      CAST(SUM(CASE WHEN outcome IN ('expected','passed') THEN 1 ELSE 0 END) AS REAL)
        / NULLIF(COUNT(*), 0) AS recentPassRate,
      AVG(CASE WHEN duration >= 0 THEN duration END) AS avgDuration,
      (SELECT outcome FROM recent ORDER BY createdAt DESC LIMIT 1) AS latestOutcome
    FROM recent
  )
  UPDATE tests SET
    totalRuns = COALESCE((SELECT totalRuns FROM totals), 0),
    latestRunAt = (SELECT latestRunAt FROM totals),
    latestOutcome = (SELECT latestOutcome FROM recent_agg),
    latestNonSkippedAt = (SELECT createdAt FROM latest_ns),
    latestFailureCategory = (SELECT failure_category FROM latest_ns),
    recentPassRate = (SELECT recentPassRate FROM recent_agg),
    avgDuration = (SELECT avgDuration FROM recent_agg)
  WHERE testId=:testId AND fileId=:fileId AND project=:project
`;

export interface TestDetailStatsAggregate {
  totalRuns: number;
  passed: number | null;
  flaky: number | null;
  skipped: number | null;
  firstRunAt: string | null;
  lastRunAt: string | null;
  durCount: number;
  mean: number | null;
  minD: number | null;
  maxD: number | null;
  variance: number | null;
  p95: number | null;
  median: number | null;
}

export const TEST_DETAIL_STATS_SQL = `
  WITH base AS (
    SELECT outcome, duration, createdAt
    FROM test_runs
    WHERE testId = :testId AND fileId = :fileId AND project = :project
  ),
  dur AS (
    SELECT duration, ROW_NUMBER() OVER (ORDER BY duration ASC) AS rn
    FROM base
    WHERE duration IS NOT NULL AND duration >= 0
  ),
  dagg AS (
    SELECT
      COUNT(*) AS durCount,
      AVG(duration) AS mean,
      MIN(duration) AS minD,
      MAX(duration) AS maxD,
      AVG(CAST(duration AS REAL) * duration) - AVG(duration) * AVG(duration) AS variance
    FROM base
    WHERE duration IS NOT NULL AND duration >= 0
  )
  SELECT
    (SELECT COUNT(*) FROM base) AS totalRuns,
    (SELECT COALESCE(SUM(CASE WHEN outcome IN ('expected', 'passed') THEN 1 ELSE 0 END), 0) FROM base) AS passed,
    (SELECT COALESCE(SUM(CASE WHEN outcome = 'flaky' THEN 1 ELSE 0 END), 0) FROM base) AS flaky,
    (SELECT COALESCE(SUM(CASE WHEN outcome = 'skipped' THEN 1 ELSE 0 END), 0) FROM base) AS skipped,
    (SELECT MIN(createdAt) FROM base) AS firstRunAt,
    (SELECT MAX(createdAt) FROM base) AS lastRunAt,
    dagg.durCount AS durCount,
    dagg.mean AS mean,
    dagg.minD AS minD,
    dagg.maxD AS maxD,
    dagg.variance AS variance,
    (SELECT duration FROM dur WHERE rn = CAST((dagg.durCount - 1) * 0.95 AS INTEGER) + 1) AS p95,
    (SELECT AVG(duration) FROM dur WHERE rn IN ((dagg.durCount + 1) / 2, (dagg.durCount + 2) / 2)) AS median
  FROM dagg
`;

export class TestDbBase {
  protected readonly k = getKysely();
  protected readonly db: Database.Database = getDatabase();
}
