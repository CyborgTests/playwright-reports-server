import { randomUUID as uuid } from 'node:crypto';
import type { FailureCategorySource, ReportTestOutcomeEnum } from '@playwright-reports/shared';
import { sql } from 'kysely';
import { getDatabase } from './db.js';
import { decodeFailureDetails, encodeFailureDetails } from './failureDetailsCodec.js';
import { getKysely } from './kysely.js';
import type { DerivedPageOptions } from './queries/testAnalytics.js';
import * as testQueries from './queries/testAnalytics.js';
import { singletonOf } from './singleton.js';
import { chunk } from './utils.js';

export interface Test {
  testId: string;
  fileId: string;
  filePath: string;
  project: string;
  title: string;
  createdAt: string;
  flakinessResetAt?: string;
}

export interface TestRun {
  runId: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  outcome: string;
  duration?: number;
  createdAt: string;
  flakinessScore?: number;
  quarantineReason?: string;
  quarantined?: boolean;
  fixedAt?: string;
  failureDetails?: string;
  failureCategory?: string;
  failureCategorySource?: FailureCategorySource;
  errorSignature?: string;
  errorSignatureGlobal?: string;
  reportTitle?: string;
  reportDisplayNumber?: number;
}

export interface TestWithQuarantineInfo extends Test {
  isQuarantined?: boolean;
  quarantinedAt?: string;
  quarantineReason?: string;
  flakinessScore?: number;
  flakinessResetAt?: string;
  totalRuns?: number;
  lastRunAt?: string;
  runs?: TestRun[];
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
  flakinessScore: number | null;
  quarantineReason: string | null;
  quarantined: number;
  fixedAt?: string | null;
  failure_details: Buffer | string | null;
  failure_category: string | null;
  failure_category_source: string | null;
  error_signature: string | null;
  error_signature_global: string | null;
  reportTitle?: string | null;
  reportDisplayNumber?: number | null;
}

export function convertDbRowToTestRun(row: TestRunDbRow): TestRun {
  return {
    runId: row.runId,
    testId: row.testId,
    fileId: row.fileId,
    project: row.project,
    reportId: row.reportId,
    outcome: row.outcome,
    duration: row.duration ?? undefined,
    createdAt: row.createdAt,
    flakinessScore: row.flakinessScore ?? undefined,
    quarantineReason: row.quarantineReason ?? undefined,
    quarantined: Boolean(row.quarantined),
    fixedAt: row.fixedAt ?? undefined,
    failureDetails: decodeFailureDetails(row.failure_details) || undefined,
    failureCategory: row.failure_category || undefined,
    failureCategorySource: (row.failure_category_source as FailureCategorySource) || undefined,
    errorSignature: row.error_signature || undefined,
    errorSignatureGlobal: row.error_signature_global || undefined,
    reportTitle: row.reportTitle ?? undefined,
    reportDisplayNumber: row.reportDisplayNumber ?? undefined,
  };
}

const REFRESH_TEST_STAT_SQL = `
  WITH recent AS (
    SELECT outcome, duration, createdAt
    FROM test_runs
    WHERE testId=:testId AND fileId=:fileId AND project=:project
    ORDER BY createdAt DESC
    LIMIT 50
  ),
  latest_ns AS (
    SELECT flakinessScore, quarantined, quarantineReason, createdAt, failure_category
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
    flakinessScore = (SELECT flakinessScore FROM latest_ns),
    quarantined = COALESCE((SELECT quarantined FROM latest_ns), 0),
    quarantineReason = (SELECT quarantineReason FROM latest_ns),
    latestFailureCategory = (SELECT failure_category FROM latest_ns),
    recentPassRate = (SELECT recentPassRate FROM recent_agg),
    avgDuration = (SELECT avgDuration FROM recent_agg)
  WHERE testId=:testId AND fileId=:fileId AND project=:project
`;

export class TestDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();
  private readonly refreshTestStatStmt = this.db.prepare(REFRESH_TEST_STAT_SQL);

  public refreshTestStatCols(testId: string, fileId: string, project: string): void {
    this.refreshTestStatStmt.run({ testId, fileId, project });
  }

  public createTest(test: Omit<Test, 'createdAt'>): Test {
    const testWithCreatedAt = {
      ...test,
      createdAt: new Date().toISOString(),
    };
    const compiled = this.k
      .insertInto('tests')
      .values({
        testId: String(testWithCreatedAt.testId),
        fileId: String(testWithCreatedAt.fileId),
        filePath: String(testWithCreatedAt.filePath),
        project: String(testWithCreatedAt.project),
        title: String(testWithCreatedAt.title),
        createdAt: String(testWithCreatedAt.createdAt),
        latestRunAt: null,
        latestOutcome: null,
        latestNonSkippedAt: null,
        flakinessScore: null,
        quarantined: 0,
        quarantineReason: null,
        totalRuns: 0,
        recentPassRate: null,
        avgDuration: null,
        latestFailureCategory: null,
        flakinessResetAt: null,
      })
      .onConflict((oc) => oc.doNothing())
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
    return testWithCreatedAt;
  }

  public getTest(testId: string, fileId: string, project: string): Test | undefined {
    const compiled = this.k
      .selectFrom('tests')
      .selectAll()
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as Test | undefined;
  }

  public getTestsByKeys(
    keys: Array<{ testId: string; fileId: string; project: string }>
  ): Map<string, { title: string; filePath: string }> {
    const out = new Map<string, { title: string; filePath: string }>();
    if (keys.length === 0) return out;
    for (const part of chunk(keys, 300)) {
      const tuples = part.map(() => '(?, ?, ?)').join(', ');
      const params = part.flatMap((k) => [k.testId, k.fileId, k.project]);
      const sqlText = `SELECT testId, fileId, project, title, filePath FROM tests
        WHERE (testId, fileId, project) IN (VALUES ${tuples})`;
      const rows = this.db.prepare(sqlText).all(...params) as Array<{
        testId: string;
        fileId: string;
        project: string;
        title: string;
        filePath: string;
      }>;
      for (const r of rows) {
        out.set(`${r.testId}::${r.fileId}::${r.project}`, { title: r.title, filePath: r.filePath });
      }
    }
    return out;
  }

  public findTestByIds(testId: string, fileId: string): Test | undefined {
    const compiled = this.k
      .selectFrom('tests as t')
      .leftJoin('test_runs as r', (join) =>
        join
          .onRef('r.testId', '=', 't.testId')
          .onRef('r.fileId', '=', 't.fileId')
          .onRef('r.project', '=', 't.project')
      )
      .select(['t.testId', 't.fileId', 't.filePath', 't.project', 't.title', 't.createdAt'])
      .where('t.testId', '=', testId)
      .where('t.fileId', '=', fileId)
      .groupBy(['t.testId', 't.fileId', 't.project'])
      .orderBy(sql`MAX(COALESCE(r.createdAt, t.createdAt))`, 'desc')
      .limit(1)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as Test | undefined;
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

  public getTestTitle(testId: string, project?: string): string | undefined {
    let q = this.k.selectFrom('tests').select('title').where('testId', '=', testId).limit(1);
    if (project && project !== 'all') q = q.where('project', '=', project);
    const compiled = q.compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { title: string }
      | undefined;
    return row?.title ?? undefined;
  }

  public findByTestId(testId: string, project?: string): Test | undefined {
    const queryFor = (proj?: string) => {
      let q = this.k
        .selectFrom('tests as t')
        .leftJoin('test_runs as r', (join) =>
          join
            .onRef('r.testId', '=', 't.testId')
            .onRef('r.fileId', '=', 't.fileId')
            .onRef('r.project', '=', 't.project')
        )
        .select(['t.testId', 't.fileId', 't.filePath', 't.project', 't.title', 't.createdAt'])
        .where('t.testId', '=', testId)
        .groupBy(['t.testId', 't.fileId', 't.project'])
        .orderBy(sql`MAX(COALESCE(r.createdAt, t.createdAt))`, 'desc')
        .limit(1);
      if (proj) q = q.where('t.project', '=', proj);
      return q.compile();
    };

    if (project && project !== 'all') {
      const compiled = queryFor(project);
      const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as Test | undefined;
      if (row) return row;
    }
    const compiled = queryFor();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as Test | undefined;
  }

  public getAllTests(): Test[] {
    const compiled = this.k.selectFrom('tests').selectAll().orderBy('createdAt', 'desc').compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as Test[];
  }

  public getTestsByProject(project: string): Test[] {
    const compiled = this.k
      .selectFrom('tests')
      .selectAll()
      .where('project', '=', project)
      .orderBy('createdAt', 'desc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as Test[];
  }

  public deleteTest(testId: string, fileId: string, project: string): void {
    const compiled = this.k
      .deleteFrom('tests')
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteTestRuns(testId: string, fileId: string, project: string): void {
    const compiled = this.k
      .deleteFrom('test_runs')
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public createTestRun(testRun: Omit<TestRun, 'runId'> & { runId?: string }): TestRun {
    const testRunWithId = {
      ...testRun,
      runId: testRun.runId || uuid(),
      quarantined: testRun.quarantined || false,
    };

    const compiled = this.k
      .insertInto('test_runs')
      .values({
        runId: String(testRunWithId.runId),
        testId: String(testRunWithId.testId),
        fileId: String(testRunWithId.fileId),
        project: String(testRunWithId.project),
        reportId: String(testRunWithId.reportId),
        outcome: String(testRunWithId.outcome),
        duration:
          testRunWithId.duration !== undefined && testRunWithId.duration !== null
            ? Number(testRunWithId.duration)
            : null,
        createdAt: String(testRunWithId.createdAt),
        flakinessScore: testRunWithId.flakinessScore ?? 0,
        quarantineReason: testRunWithId.quarantineReason || null,
        quarantined: testRunWithId.quarantined ? 1 : 0,
        fixedAt: null,
        failure_details: encodeFailureDetails(testRunWithId.failureDetails),
        failure_category: testRunWithId.failureCategory || null,
        failure_category_source: testRunWithId.failureCategorySource || null,
        error_signature: testRunWithId.errorSignature || null,
        error_signature_global: testRunWithId.errorSignatureGlobal || null,
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);

    return testRunWithId;
  }

  public updateLatestTestRun(
    testId: string,
    fileId: string,
    project: string,
    isQuarantined: boolean,
    quarantineReason?: string
  ): boolean {
    const quarantinedInt = isQuarantined ? 1 : 0;
    const latestRun = this.getLatestTestRun(testId, fileId, project);
    if (!latestRun) {
      throw new Error('No test run found for the specified test');
    }

    const compiled = isQuarantined
      ? this.k
          .updateTable('test_runs')
          .set({
            quarantined: quarantinedInt,
            quarantineReason: quarantineReason || null,
            fixedAt: null,
          })
          .where('runId', '=', latestRun.runId)
          .compile()
      : this.k
          .updateTable('test_runs')
          .set({ quarantined: quarantinedInt, fixedAt: new Date().toISOString() })
          .where('runId', '=', latestRun.runId)
          .compile();
    const result = this.db.prepare(compiled.sql).run(...compiled.parameters);
    return result.changes > 0;
  }

  public getTestRuns(testId: string, fileId: string, project: string): TestRun[] {
    const compiled = this.k
      .selectFrom('test_runs as tr')
      .leftJoin('reports as r', 'r.reportID', 'tr.reportId')
      .selectAll('tr')
      .select(['r.title as reportTitle', 'r.displayNumber as reportDisplayNumber'])
      .where('tr.testId', '=', testId)
      .where('tr.fileId', '=', fileId)
      .where('tr.project', '=', project)
      .orderBy('tr.createdAt', 'desc')
      .limit(50)
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as TestRunDbRow[];
    return rows.map((row) => convertDbRowToTestRun(row));
  }

  public getLatestTestRun(testId: string, fileId: string, project: string): TestRun | undefined {
    const compiled = this.k
      .selectFrom('test_runs')
      .selectAll()
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .where('outcome', '!=', 'skipped')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | TestRunDbRow
      | undefined;
    return row ? convertDbRowToTestRun(row) : undefined;
  }

  public getLatestFailedRunsByTestIds(
    testIds: string[],
    project?: string
  ): Map<string, { testId: string; fileId: string; project: string; failureDetails?: string }> {
    const out = new Map<
      string,
      { testId: string; fileId: string; project: string; failureDetails?: string }
    >();
    if (testIds.length === 0) return out;
    const placeholders = testIds.map(() => '?').join(', ');
    const projectClause = project ? 'AND project = ?' : '';
    const params: (string | number)[] = [...testIds];
    if (project) params.push(project);
    const sqlText = `
      SELECT testId, fileId, project, failure_details FROM (
        SELECT testId, fileId, project, failure_details, createdAt,
          ROW_NUMBER() OVER (
            PARTITION BY testId
            ORDER BY createdAt DESC
          ) AS rn
        FROM test_runs
        WHERE testId IN (${placeholders})
          AND outcome IN ('unexpected', 'failed', 'flaky')
          ${projectClause}
      ) WHERE rn = 1
    `;
    const rows = this.db.prepare(sqlText).all(...params) as Array<{
      testId: string;
      fileId: string;
      project: string;
      failure_details: Buffer | string | null;
    }>;
    for (const row of rows) {
      out.set(row.testId, {
        testId: row.testId,
        fileId: row.fileId,
        project: row.project,
        failureDetails: decodeFailureDetails(row.failure_details) || undefined,
      });
    }
    return out;
  }

  public getRecentTestRunsForFlakiness(
    testId: string,
    fileId: string,
    project: string,
    cutoffDate: string
  ): Array<{ outcome: ReportTestOutcomeEnum }> {
    const compiled = this.k
      .selectFrom('test_runs')
      .select('outcome')
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .where('outcome', '!=', 'skipped')
      .where('createdAt', '>=', cutoffDate)
      .orderBy('createdAt', 'desc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      outcome: ReportTestOutcomeEnum;
    }>;
  }

  public getTestRunCount(testId: string, fileId: string, project: string): number {
    const compiled = this.k
      .selectFrom('test_runs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    const result = this.db.prepare(compiled.sql).get(...compiled.parameters) as { count: number };
    return result.count;
  }

  public getTestWithDerivedData(
    testId: string,
    fileId: string,
    project: string
  ): TestWithQuarantineInfo | undefined {
    const test = this.getTest(testId, fileId, project);
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

    const latestRun = this.getLatestTestRun(testId, fileId, project);

    return {
      ...test,
      totalRuns: stats.totalRuns || 0,
      lastRunAt: stats.lastRunAt || undefined,
      flakinessScore: latestRun?.flakinessScore,
      flakinessResetAt: test.flakinessResetAt ?? undefined,
      isQuarantined: latestRun?.quarantined || false,
      quarantinedAt: latestRun?.quarantined ? latestRun.createdAt : undefined,
      quarantineReason: latestRun?.quarantined ? latestRun?.quarantineReason : undefined,
    };
  }

  // Delegate to testQueries (kept as raw SQL by design — see file header).
  public getDerivedPage(
    project: string | undefined,
    options: DerivedPageOptions = {}
  ): { rows: DerivedPageRow[]; total: number } {
    return testQueries.getDerivedPage(this.db, project, options);
  }
  public getRunsForLanes(
    lanes: Array<{ testId: string; fileId: string; project: string }>,
    opts?: { from?: string; to?: string }
  ): Map<string, TestRun[]> {
    return testQueries.getRunsForLanes(this.db, lanes, opts);
  }
  public getTestsSummary(
    project: string | undefined,
    warningThreshold: number
  ): { total: number; flakyTests: TestWithQuarantineInfo[] } {
    return testQueries.getTestsSummary(this.db, project, warningThreshold);
  }
  public getDurationAggregates(
    project: string | undefined,
    from?: string,
    to?: string
  ): { avgDuration: number; p95Duration: number; count: number } {
    return testQueries.getDurationAggregates(this.db, project, from, to);
  }
  public getSlowestTests(
    project: string | undefined,
    from: string | undefined,
    to: string | undefined,
    limit: number
  ): Array<{ step: string; duration: number; testId: string }> {
    return testQueries.getSlowestTests(this.db, project, from, to, limit);
  }
  public getSlowCountsByReport(
    project: string | undefined,
    from: string | undefined,
    to: string | undefined,
    threshold: number
  ): Map<string, number> {
    return testQueries.getSlowCountsByReport(this.db, project, from, to, threshold);
  }
  public getFlakySummaryInWindow(
    project: string | undefined,
    from: string,
    to: string,
    warningThreshold: number
  ): { total: number; flakyCount: number } {
    return testQueries.getFlakySummaryInWindow(this.db, project, from, to, warningThreshold);
  }
  public getTestRunsInWindow(project: string | undefined, from: string, to: string): TestRun[] {
    return testQueries.getTestRunsInWindow(this.db, project, from, to);
  }
  public getTopFailingTestsInWindow(
    project: string | undefined,
    from: string,
    to: string,
    limit: number
  ): Array<{
    testId: string;
    fileId: string;
    project: string;
    title: string;
    failureCount: number;
  }> {
    return testQueries.getTopFailingTestsInWindow(this.db, project, from, to, limit);
  }
  public getFlakiestTestsInWindow(
    project: string | undefined,
    from: string,
    to: string,
    limit: number,
    minScore: number
  ): Array<{
    testId: string;
    fileId: string;
    project: string;
    title: string;
    flakinessScore: number;
  }> {
    return testQueries.getFlakiestTestsInWindow(this.db, project, from, to, limit, minScore);
  }

  public updateFlakinessScore(runId: string, score: number): void {
    const compiled = this.k
      .updateTable('test_runs')
      .set({ flakinessScore: score })
      .where('runId', '=', runId)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public setFlakinessResetAt(
    testId: string,
    fileId: string,
    project: string,
    timestamp: string | null
  ): void {
    const compiled = this.k
      .updateTable('tests')
      .set({ flakinessResetAt: timestamp })
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getTestRunsByReport(reportId: string): TestRun[] {
    const compiled = this.k
      .selectFrom('test_runs')
      .selectAll()
      .where('reportId', '=', reportId)
      .orderBy('createdAt', 'desc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as TestRunDbRow[];
    return rows.map((row) => convertDbRowToTestRun(row));
  }

  public updateFailureCategory(
    runId: string,
    category: string,
    source: FailureCategorySource = 'heuristic'
  ): void {
    const compiled = this.k
      .updateTable('test_runs')
      .set({ failure_category: category, failure_category_source: source })
      .where('runId', '=', runId)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getCategoryConsensus(
    signature: string
  ): { category: string; share: number; total: number } | null {
    if (!signature) return null;
    const compiled = this.k
      .selectFrom('test_runs')
      .select((eb) => ['failure_category as category', eb.fn.countAll<number>().as('count')])
      .where('error_signature', '=', signature)
      .where('failure_category', 'is not', null)
      .where('failure_category', '!=', 'unknown')
      .groupBy('failure_category')
      .orderBy('count', 'desc')
      .limit(5)
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      category: string;
      count: number;
    }>;
    if (rows.length === 0) return null;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const top = rows[0];
    return { category: top.category, share: top.count / total, total };
  }

  public getFailureHistory(
    testId: string,
    fileId: string,
    errorSignature: string,
    excludeReportId: string
  ): {
    priorOccurrenceCount: number;
    firstOccurrence: {
      reportId: string;
      createdAt: string;
      displayNumber: number | null;
      title: string | null;
    } | null;
  } {
    if (!errorSignature) {
      return { priorOccurrenceCount: 0, firstOccurrence: null };
    }
    const countCompiled = this.k
      .selectFrom('test_runs')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('error_signature', '=', errorSignature)
      .where('reportId', '!=', excludeReportId)
      .compile();
    const countRow = this.db.prepare(countCompiled.sql).get(...countCompiled.parameters) as {
      c: number;
    };
    const firstCompiled = this.k
      .selectFrom('test_runs as tr')
      .innerJoin('reports as r', 'r.reportID', 'tr.reportId')
      .select(['tr.reportId', 'tr.createdAt', 'r.displayNumber', 'r.title'])
      .where('tr.testId', '=', testId)
      .where('tr.fileId', '=', fileId)
      .where('tr.error_signature', '=', errorSignature)
      .where('tr.reportId', '!=', excludeReportId)
      .orderBy('tr.createdAt', 'asc')
      .limit(1)
      .compile();
    const firstRow = this.db.prepare(firstCompiled.sql).get(...firstCompiled.parameters) as
      | { reportId: string; createdAt: string; displayNumber: number | null; title: string | null }
      | undefined;
    return {
      priorOccurrenceCount: countRow?.c ?? 0,
      firstOccurrence: firstRow ?? null,
    };
  }

  public clear(): void {
    const delRuns = this.k.deleteFrom('test_runs').compile();
    this.db.prepare(delRuns.sql).run(...delRuns.parameters);
    const delTests = this.k.deleteFrom('tests').compile();
    this.db.prepare(delTests.sql).run(...delTests.parameters);
  }

  public runTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  public findRunLane(testId: string, project?: string): { fileId: string; project: string } | null {
    let q = this.k
      .selectFrom('test_runs')
      .select(['fileId', 'project'])
      .where('testId', '=', testId)
      .orderBy('createdAt', 'desc')
      .limit(1);
    if (project) q = q.where('project', '=', project);
    const compiled = q.compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { fileId: string; project: string }
      | undefined;
    return row ?? null;
  }

  public findRunLaneByReport(
    testId: string,
    reportId: string
  ): { fileId: string; project: string } | null {
    const compiled = this.k
      .selectFrom('test_runs')
      .select(['fileId', 'project'])
      .where('testId', '=', testId)
      .where('reportId', '=', reportId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { fileId: string; project: string }
      | undefined;
    return row ?? null;
  }

  public getFailureCategoryCounts(
    project?: string
  ): Array<{ category: string; occurrences: number }> {
    let q = this.k
      .selectFrom('test_runs')
      .select((eb) => ['failure_category as category', eb.fn.countAll<number>().as('occurrences')])
      .where('failure_category', 'is not', null)
      .groupBy('failure_category')
      .orderBy('occurrences', 'desc');
    if (project) q = q.where('project', '=', project);
    const compiled = q.compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      category: string;
      occurrences: number;
    }>;
  }

  public findTestSiblings(
    testId: string,
    excludeProject: string
  ): Array<{ project: string; fileId: string }> {
    const compiled = this.k
      .selectFrom('tests')
      .select(['project', 'fileId'])
      .where('testId', '=', testId)
      .where('project', '!=', excludeProject)
      .groupBy(['project', 'fileId'])
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      project: string;
      fileId: string;
    }>;
  }

  public countRunsWithSignatureSince(
    testId: string,
    fileId: string,
    project: string,
    errorSignature: string,
    sinceIso: string
  ): number {
    const compiled = this.k
      .selectFrom('test_runs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .where('error_signature', '=', errorSignature)
      .where('createdAt', '>', sinceIso)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as { count: number };
    return row.count;
  }

  public getFailedTestsWithoutAnalysis(): Array<{
    testId: string;
    fileId: string;
    project: string;
    reportId: string;
  }> {
    // NOT EXISTS subquery doesn't compose cleanly into Kysely's builder.
    // Raw SQL fragment is clearer here.
    return this.db
      .prepare(
        `SELECT DISTINCT t.testId, t.fileId, t.project, tr.reportId
         FROM test_runs tr
         JOIN tests t ON tr.testId = t.testId AND tr.fileId = t.fileId AND tr.project = t.project
         WHERE tr.failure_details IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM test_llm_analyses tla
             WHERE tla.testId = tr.testId AND tla.fileId = tr.fileId AND tla.project = tr.project
           )`
      )
      .all() as Array<{ testId: string; fileId: string; project: string; reportId: string }>;
  }
}

export const testDb = singletonOf('tests', () => new TestDatabase());
