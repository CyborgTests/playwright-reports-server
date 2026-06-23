import { randomUUID as uuid } from 'node:crypto';
import type { FailureCategorySource } from '@playwright-reports/shared';
import { sql } from 'kysely';
import { decodeFailureDetails, encodeFailureDetails } from '../failureDetailsCodec.js';
import { singletonOf } from '../singleton.js';
import { chunk } from '../utils.js';
import {
  computeRefreshStatCols,
  convertDbRowToTestRun,
  type LaneRunForRefresh,
  REFRESH_TEST_STAT_SQL,
  type Test,
  TestDbBase,
  type TestRunDbRow,
  type TestRunRow,
  type TestState,
} from './shared.js';

export class TestCrudDatabase extends TestDbBase {
  private readonly refreshTestStatStmt = this.db.prepare(REFRESH_TEST_STAT_SQL);

  public refreshTestStatCols(testId: string, fileId: string, project: string): void {
    this.refreshTestStatStmt.run({ testId, fileId, project });
  }

  public getLaneRunsForRefresh(
    testId: string,
    fileId: string,
    project: string
  ): LaneRunForRefresh[] {
    const compiled = this.k
      .selectFrom('test_runs')
      .select(['runId', 'outcome', 'duration', 'createdAt', 'failure_category as failureCategory'])
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .orderBy('createdAt', 'desc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as LaneRunForRefresh[];
  }

  public refreshTestStatColsFromRuns(
    testId: string,
    fileId: string,
    project: string,
    runsDesc: LaneRunForRefresh[],
    flakinessScore: number
  ): void {
    const stats = computeRefreshStatCols(runsDesc);
    const compiled = this.k
      .updateTable('tests')
      .set({ ...stats, flakinessScore })
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
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
        quarantineFixedAt: null,
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

  public createTestRun(testRun: Omit<TestRunRow, 'runId'> & { runId?: string }): TestRunRow {
    const testRunWithId = {
      ...testRun,
      runId: testRun.runId || uuid(),
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
        failure_details: encodeFailureDetails(testRunWithId.failureDetails),
        failure_category: testRunWithId.failureCategory || null,
        failure_category_source: testRunWithId.failureCategorySource || null,
        error_signature: testRunWithId.errorSignature || null,
        has_trace: testRunWithId.hasTrace ? 1 : 0,
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);

    return testRunWithId;
  }

  public getTestState(testId: string, fileId: string, project: string): TestState | undefined {
    const compiled = this.k
      .selectFrom('tests')
      .select([
        'flakinessScore',
        'quarantined',
        'quarantineReason',
        'quarantineFixedAt',
        'latestNonSkippedAt',
        'flakinessResetAt',
      ])
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as TestState | undefined;
  }

  public setFlakinessScore(testId: string, fileId: string, project: string, score: number): void {
    const compiled = this.k
      .updateTable('tests')
      .set({ flakinessScore: score })
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public setQuarantineState(
    testId: string,
    fileId: string,
    project: string,
    isQuarantined: boolean,
    quarantineReason?: string
  ): boolean {
    const compiled = this.k
      .updateTable('tests')
      .set(
        isQuarantined
          ? { quarantined: 1, quarantineReason: quarantineReason || null, quarantineFixedAt: null }
          : { quarantined: 0, quarantineReason: null, quarantineFixedAt: new Date().toISOString() }
      )
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    const result = this.db.prepare(compiled.sql).run(...compiled.parameters);
    return result.changes > 0;
  }

  public getTestRuns(testId: string, fileId: string, project: string): TestRunRow[] {
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

  public getLatestTestRun(testId: string, fileId: string, project: string): TestRunRow | undefined {
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

  public getBaselineCandidates(
    testId: string,
    fileId: string,
    project: string,
    excludeReportId: string,
    limit = 8
  ): TestRunRow[] {
    const compiled = this.k
      .selectFrom('test_runs')
      .selectAll()
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .where('reportId', '!=', excludeReportId)
      .where('outcome', '!=', 'skipped')
      .where('has_trace', '=', 1)
      .orderBy(sql`CASE WHEN outcome IN ('expected', 'passed') THEN 0 ELSE 1 END`, 'asc')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as TestRunDbRow[];
    return rows.map((row) => convertDbRowToTestRun(row));
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

  public getTestRunsByReport(reportId: string): TestRunRow[] {
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

  public clear(): void {
    const delRuns = this.k.deleteFrom('test_runs').compile();
    this.db.prepare(delRuns.sql).run(...delRuns.parameters);
    const delTests = this.k.deleteFrom('tests').compile();
    this.db.prepare(delTests.sql).run(...delTests.parameters);
  }

  public runTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export const testDb = singletonOf('tests', () => new TestCrudDatabase());
