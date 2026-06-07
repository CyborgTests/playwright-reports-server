import { randomUUID as uuid } from 'node:crypto';
import type { FailureCategorySource, ReportTestOutcomeEnum } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';
import { decodeFailureDetails, encodeFailureDetails } from './failureDetailsCodec.js';
import type { DerivedPageOptions } from './testQueries.sqlite.js';
import * as testQueries from './testQueries.sqlite.js';

const initiatedTestsDb = Symbol.for('playwright.reports.db.tests');
const instance = globalThis as typeof globalThis & {
  [initiatedTestsDb]?: TestDatabase;
};

export interface Test {
  testId: string;
  fileId: string;
  filePath: string;
  project: string;
  title: string;
  createdAt: string;
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

export class TestDatabase {
  private readonly db = getDatabase();

  private readonly insertTestStmt: Database.Statement<
    [string, string, string, string, string, string]
  >;
  private readonly getTestStmt: Database.Statement<[string, string, string]>;
  private readonly getAllTestsStmt: Database.Statement<[]>;
  private readonly getTestsByProjectStmt: Database.Statement<[string]>;
  private readonly deleteTestStmt: Database.Statement<[string, string, string]>;

  private readonly insertTestRunStmt: Database.Statement<
    [
      string,
      string,
      string,
      string,
      string,
      string,
      number | null,
      string,
      number,
      string | null,
      number,
      Buffer | null,
      string | null,
      string | null,
      string | null,
      string | null,
    ]
  >;
  private readonly backfillGlobalSignatureStmt: Database.Statement<[string, string]>;
  private readonly getRunsMissingGlobalSignatureStmt: Database.Statement<[]>;
  private readonly quarantineTestRunStmt: Database.Statement<[number, string | null, string]>;
  private readonly fixTestRunStmt: Database.Statement<[number, string]>;
  private readonly getTestRunsStmt: Database.Statement<[string, string, string]>;
  private readonly getLatestTestRunStmt: Database.Statement<[string, string, string]>;
  private readonly getRecentTestRunsStmt: Database.Statement<[string, string, string, string]>;
  private readonly getTestRunCountStmt: Database.Statement<[string, string, string]>;
  private readonly deleteTestRunsStmt: Database.Statement<[string, string, string]>;

  private readonly getTestStatsStmt: Database.Statement<[string, string, string]>;
  private readonly updateFlakinessScoreStmt: Database.Statement<[number, string]>;
  private readonly refreshTestStatStmt: Database.Statement<{
    testId: string;
    fileId: string;
    project: string;
  }>;

  private constructor() {
    this.insertTestStmt = this.db.prepare(`
      INSERT OR IGNORE INTO tests (testId, fileId, filePath, project, title, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.getTestStmt = this.db.prepare(`
      SELECT * FROM tests
      WHERE testId = ? AND fileId = ? AND project = ?
    `);

    this.getAllTestsStmt = this.db.prepare(`
      SELECT * FROM tests ORDER BY createdAt DESC
    `);

    this.getTestsByProjectStmt = this.db.prepare(`
      SELECT * FROM tests WHERE project = ? ORDER BY createdAt DESC
    `);

    this.deleteTestStmt = this.db.prepare(`
      DELETE FROM tests WHERE testId = ? AND fileId = ? AND project = ?
    `);

    this.insertTestRunStmt = this.db.prepare(`
      INSERT INTO test_runs (runId, testId, fileId, project, reportId, outcome, duration, createdAt, flakinessScore, quarantineReason, quarantined, failure_details, failure_category, failure_category_source, error_signature, error_signature_global)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.backfillGlobalSignatureStmt = this.db.prepare(`
      UPDATE test_runs SET error_signature_global = ? WHERE runId = ?
    `);

    this.getRunsMissingGlobalSignatureStmt = this.db.prepare(`
      SELECT runId, failure_details FROM test_runs
      WHERE error_signature_global IS NULL AND failure_details IS NOT NULL
    `);

    this.quarantineTestRunStmt = this.db.prepare(`
      UPDATE test_runs
      SET quarantined = ?, quarantineReason = ?, fixedAt = NULL
      WHERE runId = ?
    `);

    this.fixTestRunStmt = this.db.prepare(`
      UPDATE test_runs
      SET quarantined = ?, fixedAt = CURRENT_TIMESTAMP
      WHERE runId = ?
    `);

    this.getTestRunsStmt = this.db.prepare(`
      SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber
      FROM test_runs tr
      LEFT JOIN reports r ON r.reportID = tr.reportId
      WHERE tr.testId = ? AND tr.fileId = ? AND tr.project = ?
      ORDER BY tr.createdAt DESC
      LIMIT 50
    `);

    this.getLatestTestRunStmt = this.db.prepare(`
      SELECT * FROM test_runs
      WHERE testId = ? AND fileId = ? AND project = ? AND outcome != 'skipped'
      ORDER BY createdAt DESC
      LIMIT 1
    `);

    this.getRecentTestRunsStmt = this.db.prepare(`
      SELECT outcome FROM test_runs
      WHERE testId = ? AND fileId = ? AND project = ? AND outcome != 'skipped'
        AND createdAt >= ?
        ORDER BY createdAt DESC
    `);

    this.getTestRunCountStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM test_runs
      WHERE testId = ? AND fileId = ? AND project = ?
    `);

    this.deleteTestRunsStmt = this.db.prepare(`
      DELETE FROM test_runs WHERE testId = ? AND fileId = ? AND project = ?
    `);

    this.getTestStatsStmt = this.db.prepare(`
      SELECT
        COUNT(*) as totalRuns,
        MAX(createdAt) as lastRunAt,
        SUM(CASE WHEN outcome = 'flaky' THEN 1 ELSE 0 END) as flakyCount
      FROM test_runs
      WHERE testId = ? AND fileId = ? AND project = ?
    `);

    this.updateFlakinessScoreStmt = this.db.prepare(`
      UPDATE test_runs SET flakinessScore = ? WHERE runId = ?
    `);

    this.refreshTestStatStmt = this.db.prepare(`
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
    `);
  }

  public static getInstance(): TestDatabase {
    if (!instance[initiatedTestsDb]) {
      instance[initiatedTestsDb] = new TestDatabase();
      instance[initiatedTestsDb].backfillTestStatsIfNeeded();
    }
    return instance[initiatedTestsDb];
  }

  public refreshTestStatCols(testId: string, fileId: string, project: string): void {
    this.refreshTestStatStmt.run({ testId, fileId, project });
  }

  private backfillTestStatsIfNeeded(): void {
    const mark = 'tests_stats_v2';
    const has = this.db.prepare('SELECT 1 FROM schema_migration_marks WHERE mark = ?').get(mark);
    if (has) return;

    const tx = this.db.transaction(() => {
      this.db.exec(`
        UPDATE tests AS t SET
          totalRuns = COALESCE(s.totalRuns, 0),
          latestRunAt = s.latestRunAt,
          latestOutcome = s.latestOutcome,
          latestNonSkippedAt = s.latestNonSkippedAt,
          flakinessScore = s.flakinessScore,
          quarantined = COALESCE(s.quarantined, 0),
          quarantineReason = s.quarantineReason,
          latestFailureCategory = s.latestFailureCategory,
          recentPassRate = s.recentPassRate,
          avgDuration = s.avgDuration
        FROM (
          SELECT
            tt.testId, tt.fileId, tt.project,
            (SELECT COUNT(*) FROM test_runs
              WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project) AS totalRuns,
            (SELECT MAX(createdAt) FROM test_runs
              WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project) AS latestRunAt,
            (SELECT outcome FROM test_runs
              WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project
              ORDER BY createdAt DESC LIMIT 1) AS latestOutcome,
            (SELECT MAX(createdAt) FROM test_runs
              WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project AND outcome != 'skipped') AS latestNonSkippedAt,
            (SELECT flakinessScore FROM test_runs
              WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project AND outcome != 'skipped'
              ORDER BY createdAt DESC LIMIT 1) AS flakinessScore,
            (SELECT quarantined FROM test_runs
              WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project AND outcome != 'skipped'
              ORDER BY createdAt DESC LIMIT 1) AS quarantined,
            (SELECT quarantineReason FROM test_runs
              WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project AND outcome != 'skipped'
              ORDER BY createdAt DESC LIMIT 1) AS quarantineReason,
            (SELECT failure_category FROM test_runs
              WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project AND outcome != 'skipped'
              ORDER BY createdAt DESC LIMIT 1) AS latestFailureCategory,
            (SELECT CAST(SUM(CASE WHEN outcome IN ('expected','passed') THEN 1 ELSE 0 END) AS REAL)
                    / NULLIF(COUNT(*), 0)
             FROM (SELECT outcome FROM test_runs
                   WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project
                   ORDER BY createdAt DESC LIMIT 50)) AS recentPassRate,
            (SELECT AVG(CASE WHEN duration >= 0 THEN duration END)
             FROM (SELECT duration FROM test_runs
                   WHERE testId=tt.testId AND fileId=tt.fileId AND project=tt.project
                   ORDER BY createdAt DESC LIMIT 50)) AS avgDuration
          FROM tests tt
        ) s
        WHERE s.testId = t.testId AND s.fileId = t.fileId AND s.project = t.project
      `);
      this.db
        .prepare('INSERT OR IGNORE INTO schema_migration_marks (mark, appliedAt) VALUES (?, ?)')
        .run(mark, new Date().toISOString());
    });
    tx();
  }

  public createTest(test: Omit<Test, 'createdAt'>): Test {
    const testWithCreatedAt = {
      ...test,
      createdAt: new Date().toISOString(),
    };

    const validatedParams = {
      testId: String(testWithCreatedAt.testId),
      fileId: String(testWithCreatedAt.fileId),
      filePath: String(testWithCreatedAt.filePath),
      project: String(testWithCreatedAt.project),
      title: String(testWithCreatedAt.title),
      createdAt: String(testWithCreatedAt.createdAt),
    };

    this.insertTestStmt.run(
      validatedParams.testId,
      validatedParams.fileId,
      validatedParams.filePath,
      validatedParams.project,
      validatedParams.title,
      validatedParams.createdAt
    );

    return testWithCreatedAt;
  }

  public getTest(testId: string, fileId: string, project: string): Test | undefined {
    return this.getTestStmt.get(testId, fileId, project) as Test | undefined;
  }

  public findTestByIds(testId: string, fileId: string): Test | undefined {
    const row = this.db
      .prepare(
        `SELECT t.* FROM tests t
         LEFT JOIN test_runs r ON r.testId = t.testId AND r.fileId = t.fileId AND r.project = t.project
         WHERE t.testId = ? AND t.fileId = ?
         GROUP BY t.testId, t.fileId, t.project
         ORDER BY MAX(COALESCE(r.createdAt, t.createdAt)) DESC
         LIMIT 1`
      )
      .get(testId, fileId) as Test | undefined;
    return row;
  }

  public getDurationTrend(
    testId: string,
    project?: string
  ): Array<{ reportId: string; createdAt: string; duration: number }> {
    const scoped = project && project !== 'all';
    const sql = scoped
      ? `SELECT tr.reportId, tr.createdAt, tr.duration
         FROM test_runs tr
         WHERE tr.testId = ? AND tr.project = ? AND tr.duration IS NOT NULL AND tr.duration > 0
         ORDER BY tr.createdAt DESC`
      : `SELECT tr.reportId, tr.createdAt, tr.duration
         FROM test_runs tr
         WHERE tr.testId = ? AND tr.duration IS NOT NULL AND tr.duration > 0
         ORDER BY tr.createdAt DESC`;
    const params = scoped ? [testId, project as string] : [testId];
    return this.db.prepare(sql).all(...params) as Array<{
      reportId: string;
      createdAt: string;
      duration: number;
    }>;
  }

  public getTestTitle(testId: string, project?: string): string | undefined {
    const scoped = project && project !== 'all';
    const row = (
      scoped
        ? this.db
            .prepare('SELECT title FROM tests WHERE testId = ? AND project = ? LIMIT 1')
            .get(testId, project)
        : this.db.prepare('SELECT title FROM tests WHERE testId = ? LIMIT 1').get(testId)
    ) as { title: string } | undefined;
    return row?.title ?? undefined;
  }

  public findByTestId(testId: string, project?: string): Test | undefined {
    if (project && project !== 'all') {
      const row = this.db
        .prepare(
          `SELECT t.* FROM tests t
           LEFT JOIN test_runs r ON r.testId = t.testId AND r.fileId = t.fileId AND r.project = t.project
           WHERE t.testId = ? AND t.project = ?
           GROUP BY t.testId, t.fileId, t.project
           ORDER BY MAX(COALESCE(r.createdAt, t.createdAt)) DESC
           LIMIT 1`
        )
        .get(testId, project) as Test | undefined;
      if (row) return row;
    }
    const row = this.db
      .prepare(
        `SELECT t.* FROM tests t
         LEFT JOIN test_runs r ON r.testId = t.testId AND r.fileId = t.fileId AND r.project = t.project
         WHERE t.testId = ?
         GROUP BY t.testId, t.fileId, t.project
         ORDER BY MAX(COALESCE(r.createdAt, t.createdAt)) DESC
         LIMIT 1`
      )
      .get(testId) as Test | undefined;
    return row;
  }

  public getAllTests(): Test[] {
    return this.getAllTestsStmt.all() as Test[];
  }

  public getTestsByProject(project: string): Test[] {
    return this.getTestsByProjectStmt.all(project) as Test[];
  }

  public deleteTest(testId: string, fileId: string, project: string): void {
    const transaction = this.db.transaction(() => {
      this.deleteTestRunsStmt.run(testId, fileId, project);
      this.deleteTestStmt.run(testId, fileId, project);
    });
    transaction();
  }

  public deleteTestRuns(testId: string, fileId: string, project: string): void {
    this.deleteTestRunsStmt.run(testId, fileId, project);
  }

  public deleteTestRunsByReportId(reportId: string): number {
    return this.deleteTestRunsByReportIds([reportId]);
  }

  public deleteTestRunsByReportIds(reportIds: string[]): number {
    if (reportIds.length === 0) return 0;
    const placeholders = reportIds.map(() => '?').join(',');

    const transaction = this.db.transaction(() => {
      const affectedTests = this.db
        .prepare(
          `SELECT DISTINCT testId, fileId, project
           FROM test_runs WHERE reportId IN (${placeholders})`
        )
        .all(...reportIds) as Array<{ testId: string; fileId: string; project: string }>;

      const result = this.db
        .prepare(`DELETE FROM test_runs WHERE reportId IN (${placeholders})`)
        .run(...reportIds);

      if (affectedTests.length === 0) {
        return result.changes;
      }

      const CHUNK_SIZE = 300; // 300 * 3 = 900 placeholders
      for (let i = 0; i < affectedTests.length; i += CHUNK_SIZE) {
        const chunk = affectedTests.slice(i, i + CHUNK_SIZE);
        const laneSelect = chunk
          .map(() => 'SELECT ? AS testId, ? AS fileId, ? AS project')
          .join(' UNION ALL ');
        const laneParams = chunk.flatMap((t) => [t.testId, t.fileId, t.project]);
        const orphanRows = this.db
          .prepare(
            `SELECT lanes.testId, lanes.fileId, lanes.project
             FROM (${laneSelect}) AS lanes
             WHERE NOT EXISTS (
               SELECT 1 FROM test_runs tr
               WHERE tr.testId = lanes.testId
                 AND tr.fileId = lanes.fileId
                 AND tr.project = lanes.project
             )`
          )
          .all(...laneParams) as Array<{ testId: string; fileId: string; project: string }>;

        for (const orphan of orphanRows) {
          this.deleteTestStmt.run(orphan.testId, orphan.fileId, orphan.project);
        }
      }

      return result.changes;
    });

    return transaction();
  }

  public createTestRun(testRun: Omit<TestRun, 'runId'> & { runId?: string }): TestRun {
    const testRunWithId = {
      ...testRun,
      runId: testRun.runId || uuid(),
      quarantined: testRun.quarantined || false,
    };

    const validatedParams = {
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
      failureDetails: encodeFailureDetails(testRunWithId.failureDetails),
      failureCategory: testRunWithId.failureCategory || null,
      failureCategorySource: testRunWithId.failureCategorySource || null,
      errorSignature: testRunWithId.errorSignature || null,
      errorSignatureGlobal: testRunWithId.errorSignatureGlobal || null,
    };

    this.insertTestRunStmt.run(
      validatedParams.runId,
      validatedParams.testId,
      validatedParams.fileId,
      validatedParams.project,
      validatedParams.reportId,
      validatedParams.outcome,
      validatedParams.duration,
      validatedParams.createdAt,
      validatedParams.flakinessScore,
      validatedParams.quarantineReason,
      validatedParams.quarantined,
      validatedParams.failureDetails,
      validatedParams.failureCategory,
      validatedParams.failureCategorySource,
      validatedParams.errorSignature,
      validatedParams.errorSignatureGlobal
    );

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

    const result = isQuarantined
      ? this.quarantineTestRunStmt.run(quarantinedInt, quarantineReason || null, latestRun.runId)
      : this.fixTestRunStmt.run(quarantinedInt, latestRun.runId);

    return result.changes > 0;
  }

  public getTestRuns(testId: string, fileId: string, project: string): TestRun[] {
    const rows = this.getTestRunsStmt.all(testId, fileId, project) as TestRunDbRow[];
    return rows.map((row) => convertDbRowToTestRun(row));
  }

  public getLatestTestRun(testId: string, fileId: string, project: string): TestRun | undefined {
    const row = this.getLatestTestRunStmt.get(testId, fileId, project) as TestRunDbRow | undefined;
    return row ? convertDbRowToTestRun(row) : undefined;
  }

  public getRecentTestRunsForFlakiness(
    testId: string,
    fileId: string,
    project: string,
    cutoffDate: string
  ): Array<{
    outcome: ReportTestOutcomeEnum;
  }> {
    return this.getRecentTestRunsStmt.all(testId, fileId, project, cutoffDate) as Array<{
      outcome: ReportTestOutcomeEnum;
    }>;
  }

  public getTestRunCount(testId: string, fileId: string, project: string): number {
    const result = this.getTestRunCountStmt.get(testId, fileId, project) as { count: number };
    return result.count;
  }

  public getTestWithDerivedData(
    testId: string,
    fileId: string,
    project: string
  ): TestWithQuarantineInfo | undefined {
    const test = this.getTest(testId, fileId, project);
    if (!test) return undefined;

    const stats = this.getTestStatsStmt.get(testId, fileId, project) as {
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
      isQuarantined: latestRun?.quarantined || false,
      quarantinedAt: latestRun?.quarantined ? latestRun.createdAt : undefined,
      quarantineReason: latestRun?.quarantined ? latestRun?.quarantineReason : undefined,
    };
  }

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

  public getTestRunOutcomesInWindow(
    project: string | undefined,
    from: string,
    to: string
  ): Array<{ testId: string; fileId: string; project: string; outcome: ReportTestOutcomeEnum }> {
    return testQueries.getTestRunOutcomesInWindow(this.db, project, from, to);
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

  public updateFlakinessScore(runId: string, score: number): void {
    this.updateFlakinessScoreStmt.run(score, runId);
  }

  public getTestRunsByReport(reportId: string): TestRun[] {
    const rows = this.db
      .prepare('SELECT * FROM test_runs WHERE reportId = ? ORDER BY createdAt DESC')
      .all(reportId) as TestRunDbRow[];
    return rows.map((row) => convertDbRowToTestRun(row));
  }

  public updateFailureCategory(
    runId: string,
    category: string,
    source: FailureCategorySource = 'heuristic'
  ): void {
    this.db
      .prepare(
        'UPDATE test_runs SET failure_category = ?, failure_category_source = ? WHERE runId = ?'
      )
      .run(category, source, runId);
  }

  /**
   * Find the most common failure category previously assigned to runs sharing this signature.
   * Used to "lock" labels when there's a strong historical consensus, so categorization
   * stays stable across runs of the same root-cause failure.
   */
  public getCategoryConsensus(
    signature: string
  ): { category: string; share: number; total: number } | null {
    if (!signature) return null;
    const rows = this.db
      .prepare(
        `SELECT failure_category as category, COUNT(*) as count
         FROM test_runs
         WHERE error_signature = ?
           AND failure_category IS NOT NULL
           AND failure_category != 'unknown'
         GROUP BY failure_category
         ORDER BY count DESC
         LIMIT 5`
      )
      .all(signature) as Array<{ category: string; count: number }>;
    if (rows.length === 0) return null;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const top = rows[0];
    return { category: top.category, share: top.count / total, total };
  }

  /**
   * Phase 2: failure history for a (test, error_signature) — used by the injected panel
   * to surface "🆕 New error" vs "🔁 N prior occurrences". Excludes the current report
   * so the count reflects PRIOR occurrences only.
   */
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
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM test_runs
         WHERE testId = ? AND fileId = ?
           AND error_signature = ? AND reportId != ?`
      )
      .get(testId, fileId, errorSignature, excludeReportId) as { c: number };
    // Join with reports so the UI can display the user-friendly number + title
    // instead of a sliced UUID. Left-join is unnecessary — every test_run
    // FK-points at an existing report row.
    const firstRow = this.db
      .prepare(
        `SELECT tr.reportId, tr.createdAt, r.displayNumber, r.title
         FROM test_runs tr
         JOIN reports r ON r.reportID = tr.reportId
         WHERE tr.testId = ? AND tr.fileId = ?
           AND tr.error_signature = ? AND tr.reportId != ?
         ORDER BY tr.createdAt ASC
         LIMIT 1`
      )
      .get(testId, fileId, errorSignature, excludeReportId) as
      | { reportId: string; createdAt: string; displayNumber: number | null; title: string | null }
      | undefined;
    return {
      priorOccurrenceCount: countRow?.c ?? 0,
      firstOccurrence: firstRow ?? null,
    };
  }

  public backfillGlobalSignatures(computeSignature: (message: string) => string): number {
    const rows = this.getRunsMissingGlobalSignatureStmt.all() as Array<{
      runId: string;
      failure_details: Buffer | string | null;
    }>;
    if (rows.length === 0) return 0;

    let updated = 0;
    let skippedNull = 0;
    let skippedParseError = 0;
    let skippedEmptyMessage = 0;
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const decoded = decodeFailureDetails(row.failure_details);
        if (!decoded) {
          skippedNull++;
          continue;
        }
        let message = '';
        try {
          message = String((JSON.parse(decoded) as { message?: string }).message ?? '');
        } catch {
          skippedParseError++;
          continue;
        }
        if (!message) {
          skippedEmptyMessage++;
          continue;
        }
        const signature = computeSignature(message);
        this.backfillGlobalSignatureStmt.run(signature, row.runId);
        updated++;
      }
    });
    tx();
    const totalSkipped = skippedNull + skippedParseError + skippedEmptyMessage;
    if (totalSkipped > 0) {
      console.warn(
        `[tests db] backfillGlobalSignatures: updated=${updated}, skipped=${totalSkipped} ` +
          `(null=${skippedNull}, parseError=${skippedParseError}, emptyMessage=${skippedEmptyMessage})`
      );
    }
    return updated;
  }

  public clear(): void {
    this.db.prepare('DELETE FROM test_runs').run();
    this.db.prepare('DELETE FROM tests').run();
  }

  /** One-shot migration: gzip every existing plaintext `failure_details`. */
  public compressLegacyFailureDetails(): number {
    const ids = this.db
      .prepare(`SELECT runId FROM test_runs WHERE failure_details IS NOT NULL`)
      .all() as Array<{ runId: string }>;
    if (ids.length === 0) return 0;

    const getOne = this.db.prepare(`SELECT failure_details FROM test_runs WHERE runId = ?`);
    const update = this.db.prepare(`UPDATE test_runs SET failure_details = ? WHERE runId = ?`);

    let rewritten = 0;
    const tx = this.db.transaction(() => {
      for (const { runId } of ids) {
        const row = getOne.get(runId) as { failure_details: Buffer | string | null } | undefined;
        const raw = row?.failure_details;
        if (raw === null || raw === undefined) continue;
        // Already gzip-compressed → skip.
        if (Buffer.isBuffer(raw) && raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
          continue;
        }
        const plaintext = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
        if (!plaintext) continue;
        const encoded = encodeFailureDetails(plaintext);
        if (!encoded) continue;
        update.run(encoded, runId);
        rewritten++;
      }
    });
    tx();
    return rewritten;
  }

  public runTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export const testDb = TestDatabase.getInstance();
