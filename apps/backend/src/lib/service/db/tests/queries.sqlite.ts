import type {
  ReportFile,
  ReportStats,
  ReportTest,
  ReportTestFailure,
} from '@playwright-reports/shared';
import { countOutcomes } from '@playwright-reports/shared';
import { sql } from 'kysely';
import type { DerivedPageOptions } from '../queries/testAnalytics.js';
import * as testQueries from '../queries/testAnalytics.js';
import { singletonOf } from '../singleton.js';
import { parseJsonColumn } from '../utils.js';
import { testDb } from './crud.sqlite.js';
import {
  type DerivedPageRow,
  TEST_DETAIL_STATS_SQL,
  TestDbBase,
  type TestDetailStatsAggregate,
  type TestRunRow,
  type TestWithQuarantineInfoRow,
} from './shared.js';

export interface CrossProjectOccurrenceRow {
  project: string;
  fileId: string;
  flakinessScore: number | null;
  quarantined: number;
  totalRuns: number;
  lastRunAt: string | null;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
}

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
  ): CrossProjectOccurrenceRow[] {
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
        sql<number>`SUM(CASE WHEN tr.outcome IN ('expected','passed') THEN 1 ELSE 0 END)`.as(
          'expected'
        ),
        sql<number>`SUM(CASE WHEN tr.outcome = 'flaky' THEN 1 ELSE 0 END)`.as('flaky'),
        sql<number>`SUM(CASE WHEN tr.outcome = 'skipped' THEN 1 ELSE 0 END)`.as('skipped'),
        sql<number>`SUM(CASE WHEN tr.outcome NOT IN ('expected','passed','flaky','skipped') THEN 1 ELSE 0 END)`.as(
          'unexpected'
        ),
      ])
      .where('t.testId', '=', testId)
      .where('t.project', '!=', excludeProject)
      .groupBy(['t.project', 't.fileId', 't.flakinessScore', 't.quarantined'])
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as CrossProjectOccurrenceRow[];
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

  public getLaneFailureHistory(
    testId: string,
    fileId: string,
    project: string,
    errorSignature: string | null,
    excludeReportId: string,
    before: string
  ): ReportTestFailure['history'] {
    const lane = [testId, fileId, project] as const;
    const counts = this.db
      .prepare(
        `SELECT COUNT(*) AS totalFailures,
                COUNT(DISTINCT error_signature) AS distinctErrors,
                SUM(CASE WHEN error_signature = ? AND reportId <> ? THEN 1 ELSE 0 END) AS priorOccurrenceCount
           FROM test_runs
          WHERE testId = ? AND fileId = ? AND project = ? AND error_signature IS NOT NULL`
      )
      .get(errorSignature, excludeReportId, ...lane) as {
      totalFailures: number;
      distinctErrors: number;
      priorOccurrenceCount: number | null;
    };

    const previous = this.db
      .prepare(
        `SELECT error_signature AS signature, createdAt
           FROM test_runs
          WHERE testId = ? AND fileId = ? AND project = ?
            AND createdAt < ? AND error_signature IS NOT NULL
          ORDER BY createdAt DESC
          LIMIT 1`
      )
      .get(...lane, before) as { signature: string; createdAt: string } | undefined;

    const firstOccurrence = errorSignature
      ? ((this.db
          .prepare(
            `SELECT tr.reportId, tr.createdAt, r.displayNumber, r.title
               FROM test_runs tr
               JOIN reports r ON r.reportID = tr.reportId
              WHERE tr.testId = ? AND tr.fileId = ? AND tr.project = ?
                AND tr.error_signature = ? AND tr.reportId <> ?
              ORDER BY tr.createdAt ASC
              LIMIT 1`
          )
          .get(...lane, errorSignature, excludeReportId) as
          | ReportTestFailure['history']['firstOccurrence']
          | undefined) ?? null)
      : null;

    return {
      priorOccurrenceCount: errorSignature ? (counts.priorOccurrenceCount ?? 0) : null,
      firstOccurrence,
      distinctErrors: counts.distinctErrors,
      totalFailures: counts.totalFailures,
      previousFailure: previous
        ? {
            at: previous.createdAt,
            sameError: errorSignature ? previous.signature === errorSignature : null,
          }
        : null,
    };
  }

  public getReportFileTree(reportId: string): ReportFile[] {
    const rows = this.db
      .prepare(
        `SELECT tr.testId, tr.fileId, tr.outcome, tr.duration, tr.annotations,
                t.filePath, t.title, t.projectName, t.suitePath, t.tags
           FROM test_runs tr
           LEFT JOIN tests t
             ON t.testId = tr.testId AND t.fileId = tr.fileId AND t.project = tr.project
          WHERE tr.reportId = ?
          ORDER BY COALESCE(t.filePath, tr.fileId), t.title, tr.testId`
      )
      .all(reportId) as Array<{
      testId: string;
      fileId: string;
      outcome: string;
      duration: number | null;
      annotations: string | null;
      filePath: string | null;
      title: string | null;
      projectName: string | null;
      suitePath: string | null;
      tags: string | null;
    }>;

    const byFile = new Map<string, ReportFile & { stats: Required<Omit<ReportStats, 'ok'>> }>();
    for (const row of rows) {
      let file = byFile.get(row.fileId);
      if (!file) {
        file = {
          fileId: row.fileId,
          fileName: row.filePath ?? 'unknown',
          stats: { total: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
          tests: [],
        };
        byFile.set(row.fileId, file);
      }

      file.tests.push({
        testId: row.testId,
        title: row.title ?? 'Unknown Test',
        projectName: row.projectName ?? undefined,
        duration: row.duration ?? 0,
        outcome: row.outcome as ReportTest['outcome'],
        path: parseJsonColumn<string[] | undefined>(row.suitePath, undefined),
        tags: parseJsonColumn<string[] | undefined>(row.tags, undefined),
        annotations: parseJsonColumn<ReportTest['annotations']>(row.annotations, undefined),
      });
    }

    for (const file of byFile.values()) {
      file.stats = countOutcomes(file.tests.map((test) => test.outcome));
    }
    return [...byFile.values()].sort(compareBySeverity);
  }
}

type FileStats = Required<Omit<ReportStats, 'ok'>>;

function passRate(stats: FileStats): number {
  const executed = stats.expected + stats.unexpected + stats.flaky;
  return executed === 0 ? 0 : stats.expected / executed;
}

function severityRank(stats: FileStats): number {
  if (stats.unexpected > 0) return 0;
  if (stats.flaky > 0) return 1;
  return stats.expected > 0 ? 2 : 3;
}

function compareBySeverity(
  a: ReportFile & { stats: FileStats },
  b: ReportFile & { stats: FileStats }
) {
  const byRank = severityRank(a.stats) - severityRank(b.stats);
  if (byRank !== 0) return byRank;
  const byRate = passRate(a.stats) - passRate(b.stats);
  if (byRate !== 0) return byRate;
  return a.fileName.localeCompare(b.fileName);
}

export const testQueriesDb = singletonOf('testQueries', () => new TestQueriesDatabase());
