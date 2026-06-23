import { sql } from 'kysely';
import type { DerivedPageOptions } from '../queries/testAnalytics.js';
import * as testQueries from '../queries/testAnalytics.js';
import { singletonOf } from '../singleton.js';
import { testDb } from './crud.sqlite.js';
import {
  type DerivedPageRow,
  TEST_DETAIL_STATS_SQL,
  TestDbBase,
  type TestDetailStatsAggregate,
  type TestRunRow,
  type TestWithQuarantineInfoRow,
} from './shared.js';

export class TestQueriesDatabase extends TestDbBase {
  private readonly testDetailStatsStmt = this.db.prepare(TEST_DETAIL_STATS_SQL);

  public getTestDetailStatsAggregate(
    testId: string,
    fileId: string,
    project: string
  ): TestDetailStatsAggregate {
    const row = this.testDetailStatsStmt.get({ testId, fileId, project }) as
      | TestDetailStatsAggregate
      | undefined;
    return (
      row ?? {
        totalRuns: 0,
        passed: 0,
        flaky: 0,
        skipped: 0,
        firstRunAt: null,
        lastRunAt: null,
        durCount: 0,
        mean: null,
        minD: null,
        maxD: null,
        variance: null,
        p95: null,
        median: null,
      }
    );
  }

  public getDurationTrend(
    testId: string,
    project?: string
  ): Array<{ reportId: string; createdAt: string; duration: number }> {
    let q = this.k
      .selectFrom('test_runs')
      .select(['reportId', 'createdAt', 'duration'])
      .where('testId', '=', testId)
      .where('duration', 'is not', null)
      .where('duration', '>', 0)
      .orderBy('createdAt', 'desc');
    if (project && project !== 'all') q = q.where('project', '=', project);
    const compiled = q.compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      reportId: string;
      createdAt: string;
      duration: number;
    }>;
  }

  public getTestRunPointsPage(
    testId: string,
    fileId: string,
    project: string,
    opts: { before?: string; limit?: number } = {}
  ): TestRunRow[] {
    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 500) : 100;
    let q = this.k
      .selectFrom('test_runs as tr')
      .leftJoin('reports as r', 'r.reportID', 'tr.reportId')
      .select([
        'tr.runId',
        'tr.testId',
        'tr.fileId',
        'tr.project',
        'tr.reportId',
        'tr.outcome',
        'tr.duration',
        'tr.createdAt',
        'tr.failure_category as failureCategory',
        'r.title as reportTitle',
        'r.displayNumber as reportDisplayNumber',
      ])
      .where('tr.testId', '=', testId)
      .where('tr.fileId', '=', fileId)
      .where('tr.project', '=', project)
      .orderBy('tr.createdAt', 'desc');
    if (opts.before) q = q.where('tr.createdAt', '<', opts.before);
    const compiled = q.limit(limit).compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      runId: string;
      testId: string;
      fileId: string;
      project: string;
      reportId: string;
      outcome: string;
      duration: number | null;
      createdAt: string;
      failureCategory: string | null;
      reportTitle: string | null;
      reportDisplayNumber: number | null;
    }>;
    return rows.map((row) => ({
      runId: row.runId,
      testId: row.testId,
      fileId: row.fileId,
      project: row.project,
      reportId: row.reportId,
      outcome: row.outcome,
      duration: row.duration ?? undefined,
      createdAt: row.createdAt,
      failureCategory: row.failureCategory || undefined,
      reportTitle: row.reportTitle ?? undefined,
      reportDisplayNumber: row.reportDisplayNumber ?? undefined,
    }));
  }

  public getTestWithDerivedData(
    testId: string,
    fileId: string,
    project: string
  ): TestWithQuarantineInfoRow | undefined {
    const test = testDb.getTest(testId, fileId, project);
    if (!test) return undefined;

    const statsCompiled = this.k
      .selectFrom('test_runs')
      .select((eb) => [
        eb.fn.countAll<number>().as('totalRuns'),
        eb.fn.max<string | null>('createdAt').as('lastRunAt'),
        sql<number>`SUM(CASE WHEN outcome = 'flaky' THEN 1 ELSE 0 END)`.as('flakyCount'),
      ])
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    const stats = this.db.prepare(statsCompiled.sql).get(...statsCompiled.parameters) as {
      totalRuns: number;
      lastRunAt: string | null;
      flakyCount: number;
    };

    const state = testDb.getTestState(testId, fileId, project);
    const isQuarantined = Boolean(state?.quarantined);

    return {
      ...test,
      totalRuns: stats.totalRuns || 0,
      lastRunAt: stats.lastRunAt || undefined,
      flakinessScore: state?.flakinessScore ?? undefined,
      flakinessResetAt: test.flakinessResetAt ?? undefined,
      isQuarantined,
      quarantinedAt: isQuarantined ? (state?.latestNonSkippedAt ?? undefined) : undefined,
      quarantineReason: isQuarantined ? (state?.quarantineReason ?? undefined) : undefined,
    };
  }

  public getCrossProjectOccurrences(
    testId: string,
    excludeProject: string
  ): Array<{
    project: string;
    fileId: string;
    flakinessScore: number | null;
    quarantined: number;
    totalRuns: number;
    lastRunAt: string | null;
  }> {
    const compiled = this.k
      .selectFrom('tests as t')
      .leftJoin('test_runs as tr', (join) =>
        join
          .onRef('tr.testId', '=', 't.testId')
          .onRef('tr.fileId', '=', 't.fileId')
          .onRef('tr.project', '=', 't.project')
      )
      .select((eb) => [
        't.project as project',
        't.fileId as fileId',
        't.flakinessScore as flakinessScore',
        't.quarantined as quarantined',
        eb.fn.count<number>('tr.runId').as('totalRuns'),
        eb.fn.max<string | null>('tr.createdAt').as('lastRunAt'),
      ])
      .where('t.testId', '=', testId)
      .where('t.project', '!=', excludeProject)
      .groupBy(['t.project', 't.fileId', 't.flakinessScore', 't.quarantined'])
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      project: string;
      fileId: string;
      flakinessScore: number | null;
      quarantined: number;
      totalRuns: number;
      lastRunAt: string | null;
    }>;
  }

  // Delegate to testQueries (kept as raw SQL by design - see file header).
  public getDerivedPage(
    project: string | undefined,
    options: DerivedPageOptions = {}
  ): { rows: DerivedPageRow[]; total: number } {
    return testQueries.getDerivedPage(this.db, project, options);
  }
  public getRunsForLanes(
    lanes: Array<{ testId: string; fileId: string; project: string }>,
    opts?: { from?: string; to?: string }
  ): Map<string, TestRunRow[]> {
    return testQueries.getRunsForLanes(this.db, lanes, opts);
  }
  public getTestsSummary(
    project: string | undefined,
    warningThreshold: number
  ): { total: number; flakyTests: TestWithQuarantineInfoRow[] } {
    return testQueries.getTestsSummary(this.db, project, warningThreshold);
  }
}

export const testQueriesDb = singletonOf('testQueries', () => new TestQueriesDatabase());
