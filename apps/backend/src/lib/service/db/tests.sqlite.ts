import type { FailureCategorySource, ReportTestOutcomeEnum } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { getDatabase } from './db.js';

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

export class TestDatabase {
  private readonly db = getDatabase();

  private convertDbRowToTestRun(row: any): TestRun {
    return {
      ...row,
      quarantined: Boolean(row.quarantined),
      failureDetails: row.failure_details || undefined,
      failureCategory: row.failure_category || undefined,
      failureCategorySource: (row.failure_category_source as FailureCategorySource) || undefined,
      errorSignature: row.error_signature || undefined,
      errorSignatureGlobal: row.error_signature_global || undefined,
      reportTitle: row.reportTitle ?? undefined,
      reportDisplayNumber: row.reportDisplayNumber ?? undefined,
    };
  }

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
      string | null,
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
  private readonly deleteTestRunsByReportIdStmt: Database.Statement<[string]>;
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

    this.deleteTestRunsByReportIdStmt = this.db.prepare(`
      DELETE FROM test_runs WHERE reportId = ?
    `);

    this.updateFlakinessScoreStmt = this.db.prepare(`
      UPDATE test_runs SET flakinessScore = ? WHERE runId = ?
    `);

    this.refreshTestStatStmt = this.db.prepare(`
      UPDATE tests SET
        totalRuns = (SELECT COUNT(*) FROM test_runs
          WHERE testId=:testId AND fileId=:fileId AND project=:project),
        latestRunAt = (SELECT MAX(createdAt) FROM test_runs
          WHERE testId=:testId AND fileId=:fileId AND project=:project),
        latestOutcome = (SELECT outcome FROM test_runs
          WHERE testId=:testId AND fileId=:fileId AND project=:project
          ORDER BY createdAt DESC LIMIT 1),
        latestNonSkippedAt = (SELECT MAX(createdAt) FROM test_runs
          WHERE testId=:testId AND fileId=:fileId AND project=:project AND outcome != 'skipped'),
        flakinessScore = (SELECT flakinessScore FROM test_runs
          WHERE testId=:testId AND fileId=:fileId AND project=:project AND outcome != 'skipped'
          ORDER BY createdAt DESC LIMIT 1),
        quarantined = COALESCE((SELECT quarantined FROM test_runs
          WHERE testId=:testId AND fileId=:fileId AND project=:project AND outcome != 'skipped'
          ORDER BY createdAt DESC LIMIT 1), 0),
        quarantineReason = (SELECT quarantineReason FROM test_runs
          WHERE testId=:testId AND fileId=:fileId AND project=:project AND outcome != 'skipped'
          ORDER BY createdAt DESC LIMIT 1),
        recentPassRate = (
          SELECT CAST(SUM(CASE WHEN outcome IN ('expected','passed') THEN 1 ELSE 0 END) AS REAL)
                 / NULLIF(COUNT(*), 0)
          FROM (SELECT outcome FROM test_runs
                WHERE testId=:testId AND fileId=:fileId AND project=:project
                ORDER BY createdAt DESC LIMIT 50)
        ),
        avgDuration = (
          SELECT AVG(CASE WHEN duration >= 0 THEN duration END)
          FROM (SELECT duration FROM test_runs
                WHERE testId=:testId AND fileId=:fileId AND project=:project
                ORDER BY createdAt DESC LIMIT 50)
        )
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
    const mark = 'tests_stats_v1';
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
    const transaction = this.db.transaction(() => {
      const affectedTestsStmt = this.db.prepare(`
        SELECT DISTINCT testId, fileId, project FROM test_runs WHERE reportId = ?
      `);
      const affectedTests = affectedTestsStmt.all(reportId) as Array<{
        testId: string;
        fileId: string;
        project: string;
      }>;

      const result = this.deleteTestRunsByReportIdStmt.run(reportId);

      // Drop tests that no longer have any runs after this deletion.
      const checkRunsStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM test_runs WHERE testId = ? AND fileId = ? AND project = ?
      `);

      for (const test of affectedTests) {
        const { count } = checkRunsStmt.get(test.testId, test.fileId, test.project) as {
          count: number;
        };
        if (count === 0) {
          this.deleteTestStmt.run(test.testId, test.fileId, test.project);
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
      failureDetails: testRunWithId.failureDetails || null,
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
    const rows = this.getTestRunsStmt.all(testId, fileId, project);
    return rows.map((row) => this.convertDbRowToTestRun(row));
  }

  public getLatestTestRun(testId: string, fileId: string, project: string): TestRun | undefined {
    const row = this.getLatestTestRunStmt.get(testId, fileId, project);
    return row ? this.convertDbRowToTestRun(row) : undefined;
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
      failureCount: number;
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

  public getAllAndDerivedData(project?: string): TestWithQuarantineInfo[] {
    const scoped = project && project !== 'all';
    const testProjectFilter = scoped ? 'WHERE t.project = ?' : '';
    const aggProjectFilter = scoped ? 'WHERE project = ?' : '';
    const latestProjectFilter = scoped
      ? "WHERE outcome != 'skipped' AND project = ?"
      : "WHERE outcome != 'skipped'";
    const runsProjectFilter = scoped ? 'WHERE tr.project = ?' : '';
    const derivedParams = scoped ? [project, project, project] : [];

    const derivedSql = `
      SELECT
        t.testId, t.fileId, t.filePath, t.project, t.title, t.createdAt,
        COALESCE(agg.totalRuns, 0) AS totalRuns,
        agg.lastRunAt AS lastRunAt,
        latest.flakinessScore AS flakinessScore,
        COALESCE(latest.quarantined, 0) AS quarantined,
        latest.createdAt AS latestRunAt,
        latest.quarantineReason AS quarantineReason
      FROM tests t
      LEFT JOIN (
        SELECT testId, fileId, project,
               COUNT(*) AS totalRuns,
               MAX(createdAt) AS lastRunAt
        FROM test_runs
        ${aggProjectFilter}
        GROUP BY testId, fileId, project
      ) agg
        ON agg.testId = t.testId AND agg.fileId = t.fileId AND agg.project = t.project
      LEFT JOIN (
        SELECT testId, fileId, project, flakinessScore, quarantined, createdAt, quarantineReason
        FROM (
          SELECT testId, fileId, project, flakinessScore, quarantined, createdAt, quarantineReason,
                 ROW_NUMBER() OVER (
                   PARTITION BY testId, fileId, project ORDER BY createdAt DESC
                 ) AS rn
          FROM test_runs
          ${latestProjectFilter}
        )
        WHERE rn = 1
      ) latest
        ON latest.testId = t.testId AND latest.fileId = t.fileId AND latest.project = t.project
      ${testProjectFilter}
      ORDER BY t.createdAt DESC
    `;

    const derivedRows = this.db.prepare(derivedSql).all(...derivedParams) as Array<{
      testId: string;
      fileId: string;
      filePath: string;
      project: string;
      title: string;
      createdAt: string;
      totalRuns: number;
      lastRunAt: string | null;
      flakinessScore: number | null;
      quarantined: number | null;
      latestRunAt: string | null;
      quarantineReason: string | null;
    }>;

    const runsSql = `
      SELECT
        testId, fileId, project, runId, outcome, duration, createdAt,
        flakinessScore, quarantineReason, quarantined, fixedAt,
        failure_details, failure_category, failure_category_source,
        error_signature, error_signature_global,
        reportId, reportTitle, reportDisplayNumber
      FROM (
        SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber,
               ROW_NUMBER() OVER (
                 PARTITION BY tr.testId, tr.fileId, tr.project
                 ORDER BY tr.createdAt DESC
               ) AS rn
        FROM test_runs tr
        LEFT JOIN reports r ON r.reportID = tr.reportId
        ${runsProjectFilter}
      )
      WHERE rn <= 50
      ORDER BY testId, fileId, project, createdAt DESC
    `;
    const runRows = this.db.prepare(runsSql).all(...(scoped ? [project] : [])) as Array<
      Record<string, unknown>
    >;

    const runsByKey = new Map<string, TestRun[]>();
    for (const row of runRows) {
      const key = `${row.testId}::${row.fileId}::${row.project}`;
      let bucket = runsByKey.get(key);
      if (!bucket) {
        bucket = [];
        runsByKey.set(key, bucket);
      }
      bucket.push(this.convertDbRowToTestRun(row));
    }

    return derivedRows.map((row) => {
      const key = `${row.testId}::${row.fileId}::${row.project}`;
      const isQuarantined = Boolean(row.quarantined);
      return {
        testId: row.testId,
        fileId: row.fileId,
        filePath: row.filePath,
        project: row.project,
        title: row.title,
        createdAt: row.createdAt,
        totalRuns: row.totalRuns || 0,
        lastRunAt: row.lastRunAt || undefined,
        flakinessScore: row.flakinessScore ?? undefined,
        isQuarantined,
        quarantinedAt: isQuarantined && row.latestRunAt ? row.latestRunAt : undefined,
        quarantineReason: isQuarantined && row.quarantineReason ? row.quarantineReason : undefined,
        runs: runsByKey.get(key) ?? [],
      };
    });
  }

  public getDerivedPage(
    project: string | undefined,
    options: {
      status?: 'all' | 'quarantined' | 'not-quarantined';
      sort?: 'default' | 'slowest' | 'stale';
      tier?: {
        warningThreshold: number;
        quarantineThreshold: number;
        tiers: Array<'stable' | 'flaky' | 'critical'>;
      };
      failureCategory?: string;
      limit?: number;
      offset?: number;
      from?: string;
      to?: string;
      search?: string;
    } = {}
  ): { rows: DerivedPageRow[]; total: number } {
    const scoped = !!project && project !== 'all';
    const windowed = !!(options.from || options.to);

    const ctes: string[] = [];
    const cteParams: Array<string | number> = [];
    if (windowed) {
      const winConds = ["outcome != 'skipped'"];
      if (scoped) {
        winConds.push('project = ?');
        cteParams.push(project as string);
      }
      if (options.from) {
        winConds.push('createdAt >= ?');
        cteParams.push(options.from);
      }
      if (options.to) {
        winConds.push('createdAt < ?');
        cteParams.push(options.to);
      }
      ctes.push(`agg_w AS (
        SELECT testId, fileId, project, COUNT(*) AS totalRuns, MAX(createdAt) AS lastRunAt
        FROM test_runs WHERE ${winConds.join(' AND ')}
        GROUP BY testId, fileId, project
      )`);
      for (const c of winConds) {
        if (c.endsWith('?')) {
        }
      }
      if (scoped) cteParams.push(project as string);
      if (options.from) cteParams.push(options.from);
      if (options.to) cteParams.push(options.to);
      ctes.push(`recent_w AS (
        SELECT testId, fileId, project,
               CAST(SUM(CASE WHEN outcome IN ('expected', 'passed') THEN 1 ELSE 0 END) AS REAL)
                 / NULLIF(COUNT(*), 0) AS recentPassRate,
               AVG(CASE WHEN duration >= 0 THEN duration END) AS avgDuration
        FROM test_runs WHERE ${winConds.join(' AND ')}
        GROUP BY testId, fileId, project
      )`);
    }

    const totalRunsExpr = windowed ? 'COALESCE(agg_w.totalRuns, 0)' : 'COALESCE(t.totalRuns, 0)';
    const lastRunAtExpr = windowed ? 'agg_w.lastRunAt' : 't.latestRunAt';
    const passRateExpr = windowed
      ? 'COALESCE(recent_w.recentPassRate, 1.0)'
      : 'COALESCE(t.recentPassRate, 1.0)';
    const avgDurationExpr = windowed ? 'recent_w.avgDuration' : 't.avgDuration';

    const whereConds: string[] = [];
    const whereParams: Array<string | number> = [];

    if (scoped) {
      whereConds.push('t.project = ?');
      whereParams.push(project as string);
    }
    if (windowed) {
      whereConds.push('agg_w.totalRuns IS NOT NULL AND agg_w.totalRuns > 0');
    }
    if (options.status === 'quarantined') {
      whereConds.push('COALESCE(t.quarantined, 0) = 1');
    } else if (options.status === 'not-quarantined') {
      whereConds.push('COALESCE(t.quarantined, 0) = 0');
    }
    if (options.tier && options.tier.tiers.length > 0) {
      const { warningThreshold, quarantineThreshold, tiers } = options.tier;
      const tierConds: string[] = [];
      for (const tier of tiers) {
        if (tier === 'stable') {
          tierConds.push('COALESCE(t.flakinessScore, 0) < ?');
          whereParams.push(warningThreshold);
        } else if (tier === 'flaky') {
          tierConds.push(
            '(COALESCE(t.flakinessScore, 0) >= ? AND COALESCE(t.flakinessScore, 0) < ?)'
          );
          whereParams.push(warningThreshold, quarantineThreshold);
        } else if (tier === 'critical') {
          tierConds.push('COALESCE(t.flakinessScore, 0) >= ?');
          whereParams.push(quarantineThreshold);
        }
      }
      if (tierConds.length > 0) whereConds.push(`(${tierConds.join(' OR ')})`);
    }
    if (options.failureCategory) {
      whereConds.push(`EXISTS (
        SELECT 1 FROM (
          SELECT failure_category FROM test_runs
          WHERE testId = t.testId AND fileId = t.fileId AND project = t.project
          ORDER BY createdAt DESC LIMIT 50
        ) sub WHERE sub.failure_category = ?
      )`);
      whereParams.push(options.failureCategory);
    }
    if (options.search) {
      const term = `%${options.search.toLowerCase()}%`;
      whereConds.push('(LOWER(t.title) LIKE ? OR LOWER(t.filePath) LIKE ?)');
      whereParams.push(term, term);
    }

    const tieBreaker = 't.createdAt DESC, t.rowid';
    let orderBy: string;
    if (options.sort === 'slowest') {
      orderBy = `ORDER BY COALESCE(${avgDurationExpr}, -1) DESC, ${tieBreaker}`;
    } else if (options.sort === 'stale') {
      orderBy = `ORDER BY COALESCE(${lastRunAtExpr}, '') ASC, ${tieBreaker}`;
    } else {
      orderBy = `ORDER BY
        CASE WHEN t.latestOutcome = 'skipped' THEN 1 ELSE 0 END ASC,
        CASE WHEN t.latestOutcome = 'unexpected' THEN 0 ELSE 1 END ASC,
        COALESCE(t.flakinessScore, 0) DESC,
        ${passRateExpr} ASC,
        ${tieBreaker}`;
    }

    const whereSql = whereConds.length ? `WHERE ${whereConds.join(' AND ')}` : '';
    const windowJoins = windowed
      ? `
        LEFT JOIN agg_w
          ON agg_w.testId = t.testId AND agg_w.fileId = t.fileId AND agg_w.project = t.project
        LEFT JOIN recent_w
          ON recent_w.testId = t.testId AND recent_w.fileId = t.fileId
            AND recent_w.project = t.project`
      : '';
    const baseFrom = `FROM tests t ${windowJoins} ${whereSql}`;

    const pageParams: Array<string | number> = [];
    let limitSql = '';
    if (options.limit !== undefined) {
      limitSql = 'LIMIT ? OFFSET ?';
      pageParams.push(options.limit, options.offset ?? 0);
    }

    const cteHead = ctes.length > 0 ? `WITH ${ctes.join(', ')}` : '';

    const rowsSql = `${cteHead}
      SELECT
        t.testId, t.fileId, t.filePath, t.project, t.title, t.createdAt,
        ${totalRunsExpr} AS totalRuns,
        ${lastRunAtExpr} AS lastRunAt,
        t.latestOutcome AS latestOutcome,
        t.flakinessScore AS flakinessScore,
        COALESCE(t.quarantined, 0) AS quarantined,
        t.latestNonSkippedAt AS latestNonSkippedAt,
        t.quarantineReason AS quarantineReason,
        ${passRateExpr} AS recentPassRate,
        ${avgDurationExpr} AS avgDuration,
        COUNT(*) OVER () AS __total
      ${baseFrom}
      ${orderBy}
      ${limitSql}
    `;
    const rawRows = this.db
      .prepare(rowsSql)
      .all(...cteParams, ...whereParams, ...pageParams) as Array<
      DerivedPageRow & { __total: number }
    >;
    let total = rawRows.length > 0 ? rawRows[0].__total : 0;
    const rows = rawRows.map(({ __total, ...row }) => row);

    if (rawRows.length === 0 && (options.offset ?? 0) > 0) {
      const countSql = `${cteHead} SELECT COUNT(*) AS total ${baseFrom}`;
      const countRow = this.db.prepare(countSql).get(...cteParams, ...whereParams) as
        | { total: number }
        | undefined;
      total = countRow?.total ?? 0;
    }

    return { rows, total };
  }

  public getRunsForLanes(
    lanes: Array<{ testId: string; fileId: string; project: string }>,
    opts?: { from?: string; to?: string }
  ): Map<string, TestRun[]> {
    if (lanes.length === 0) return new Map();
    const windowed = !!(opts?.from || opts?.to);

    const LANE_FILTER_THRESHOLD = 200;
    const useLaneFilter = lanes.length <= LANE_FILTER_THRESHOLD;

    const uniformProject = (() => {
      const p = lanes[0].project;
      return lanes.every((l) => l.project === p) ? p : null;
    })();

    const laneRows = useLaneFilter
      ? lanes.map(() => 'SELECT ? AS testId, ? AS fileId, ? AS project').join(' UNION ALL ')
      : '';
    const laneParams: string[] = useLaneFilter
      ? lanes.flatMap((l) => [l.testId, l.fileId, l.project])
      : [];

    let sql: string;
    const params: Array<string | number> = [...laneParams];

    if (!useLaneFilter) {
      const projectFilter = uniformProject ? 'WHERE tr.project = ?' : '';
      if (uniformProject) params.push(uniformProject);

      if (windowed) {
        const winConds: string[] = ["tr.outcome != 'skipped'"];
        if (uniformProject) winConds.push('tr.project = ?'); // duplicated for clarity; same param already pushed
        if (opts?.from) {
          winConds.push('tr.createdAt >= ?');
          params.push(opts.from);
        }
        if (opts?.to) {
          winConds.push('tr.createdAt < ?');
          params.push(opts.to);
        }
        const winWhere = `WHERE ${winConds.filter((c) => c !== 'tr.project = ?' || !projectFilter).join(' AND ')}`;
        sql = `
          SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber
          FROM test_runs tr
          LEFT JOIN reports r ON r.reportID = tr.reportId
          ${winWhere}
          ORDER BY tr.testId, tr.fileId, tr.project, tr.createdAt DESC
        `;
      } else {
        sql = `
          SELECT testId, fileId, project, runId, outcome, duration, createdAt,
                 flakinessScore, quarantineReason, quarantined, fixedAt,
                 failure_details, failure_category, failure_category_source,
                 error_signature, error_signature_global,
                 reportId, reportTitle, reportDisplayNumber
          FROM (
            SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber,
                   ROW_NUMBER() OVER (
                     PARTITION BY tr.testId, tr.fileId, tr.project
                     ORDER BY tr.createdAt DESC
                   ) AS rn
            FROM test_runs tr
            LEFT JOIN reports r ON r.reportID = tr.reportId
            ${projectFilter}
          )
          WHERE rn <= 50
          ORDER BY testId, fileId, project, createdAt DESC
        `;
      }

      const runRows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const laneKeys = new Set(lanes.map((l) => `${l.testId}::${l.fileId}::${l.project}`));
      const map = new Map<string, TestRun[]>();
      for (const row of runRows) {
        const key = `${row.testId}::${row.fileId}::${row.project}`;
        if (!laneKeys.has(key)) continue;
        let bucket = map.get(key);
        if (!bucket) {
          bucket = [];
          map.set(key, bucket);
        }
        bucket.push(this.convertDbRowToTestRun(row));
      }
      return map;
    }

    if (windowed) {
      const winConds = ["tr.outcome != 'skipped'"];
      if (opts?.from) {
        winConds.push('tr.createdAt >= ?');
        params.push(opts.from);
      }
      if (opts?.to) {
        winConds.push('tr.createdAt < ?');
        params.push(opts.to);
      }
      sql = `
        WITH lanes(testId, fileId, project) AS (${laneRows})
        SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber
        FROM test_runs tr
        JOIN lanes l
          ON l.testId = tr.testId AND l.fileId = tr.fileId AND l.project = tr.project
        LEFT JOIN reports r ON r.reportID = tr.reportId
        WHERE ${winConds.join(' AND ')}
        ORDER BY tr.testId, tr.fileId, tr.project, tr.createdAt DESC
      `;
    } else {
      sql = `
        WITH lanes(testId, fileId, project) AS (${laneRows})
        SELECT testId, fileId, project, runId, outcome, duration, createdAt,
               flakinessScore, quarantineReason, quarantined, fixedAt,
               failure_details, failure_category, failure_category_source,
               error_signature, error_signature_global,
               reportId, reportTitle, reportDisplayNumber
        FROM (
          SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber,
                 ROW_NUMBER() OVER (
                   PARTITION BY tr.testId, tr.fileId, tr.project
                   ORDER BY tr.createdAt DESC
                 ) AS rn
          FROM test_runs tr
          JOIN lanes l
            ON l.testId = tr.testId AND l.fileId = tr.fileId AND l.project = tr.project
          LEFT JOIN reports r ON r.reportID = tr.reportId
        )
        WHERE rn <= 50
        ORDER BY testId, fileId, project, createdAt DESC
      `;
    }

    const runRows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    const map = new Map<string, TestRun[]>();
    for (const row of runRows) {
      const key = `${row.testId}::${row.fileId}::${row.project}`;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = [];
        map.set(key, bucket);
      }
      bucket.push(this.convertDbRowToTestRun(row));
    }
    return map;
  }

  /**
   * A test is considered flaky when its latest non-skipped run's
   * `flakinessScore` is at or above the provided warning threshold. `total`
   * counts unique testIds (so the same test running across multiple Playwright
   * projects/browsers is counted once).
   */
  public getTestsSummary(
    project: string | undefined,
    warningThreshold: number
  ): { total: number; flakyTests: TestWithQuarantineInfo[] } {
    const scoped = !!project && project !== 'all';
    const projectClause = scoped ? 'WHERE project = ?' : '';
    const projectClauseAnd = scoped ? 'AND project = ?' : '';

    const totalRow = this.db
      .prepare(`SELECT COUNT(DISTINCT testId) AS total FROM tests ${projectClause}`)
      .get(...(scoped ? [project] : [])) as { total: number };

    const flakyRows = this.db
      .prepare(
        `SELECT testId, fileId, filePath, project, title, createdAt,
                flakinessScore, quarantined
         FROM tests
         WHERE flakinessScore IS NOT NULL AND flakinessScore >= ? ${projectClauseAnd}`
      )
      .all(
        ...(scoped ? [warningThreshold, project] : [warningThreshold])
      ) as Array<Test & { flakinessScore: number; quarantined: number }>;

    const flakyTests: TestWithQuarantineInfo[] = flakyRows.map((row) => ({
      testId: row.testId,
      fileId: row.fileId,
      filePath: row.filePath,
      project: row.project,
      title: row.title,
      createdAt: row.createdAt,
      flakinessScore: row.flakinessScore,
      isQuarantined: Boolean(row.quarantined),
    }));

    return { total: totalRow?.total ?? 0, flakyTests };
  }

  public getTestRunOutcomesInWindow(
    project: string | undefined,
    from: string,
    to: string
  ): Array<{ testId: string; fileId: string; project: string; outcome: ReportTestOutcomeEnum }> {
    const conditions: string[] = ["outcome != 'skipped'"];
    const params: string[] = [];

    conditions.push('createdAt >= ?');
    params.push(from);
    conditions.push('createdAt < ?');
    params.push(to);

    if (project && project !== 'all') {
      conditions.push('project = ?');
      params.push(project);
    }

    const sql = `SELECT testId, fileId, project, outcome FROM test_runs WHERE ${conditions.join(' AND ')} ORDER BY createdAt ASC`;
    return this.db.prepare(sql).all(...params) as Array<{
      testId: string;
      fileId: string;
      project: string;
      outcome: ReportTestOutcomeEnum;
    }>;
  }

  private scopedRunFilter(
    project: string | undefined,
    from?: string,
    to?: string,
    opts: { excludeSkipped?: boolean; requireDuration?: boolean; alias?: string } = {}
  ): { where: string; params: Array<string | number> } {
    const a = opts.alias ? `${opts.alias}.` : '';
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (opts.excludeSkipped !== false) conditions.push(`${a}outcome != 'skipped'`);
    if (opts.requireDuration !== false) conditions.push(`${a}duration IS NOT NULL`);
    if (project && project !== 'all') {
      conditions.push(`${a}project = ?`);
      params.push(project);
    }
    if (from) {
      conditions.push(`${a}createdAt >= ?`);
      params.push(from);
    }
    if (to) {
      conditions.push(`${a}createdAt < ?`);
      params.push(to);
    }
    return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
  }

  public getDurationAggregates(
    project: string | undefined,
    from?: string,
    to?: string
  ): { avgDuration: number; p95Duration: number; count: number } {
    const { where, params } = this.scopedRunFilter(project, from, to);
    const agg = this.db
      .prepare(`SELECT AVG(duration) AS avg, COUNT(*) AS count FROM test_runs ${where}`)
      .get(...params) as { avg: number | null; count: number };
    const count = agg?.count ?? 0;
    if (count === 0) {
      return { avgDuration: 0, p95Duration: 0, count: 0 };
    }
    const offset = Math.min(count - 1, Math.floor(count * 0.95));
    const p95Row = this.db
      .prepare(`SELECT duration FROM test_runs ${where} ORDER BY duration ASC LIMIT 1 OFFSET ?`)
      .get(...params, offset) as { duration: number | null } | undefined;
    return {
      avgDuration: agg.avg ?? 0,
      p95Duration: p95Row?.duration ?? 0,
      count,
    };
  }

  public getSlowestTests(
    project: string | undefined,
    from: string | undefined,
    to: string | undefined,
    limit: number
  ): Array<{ step: string; duration: number; testId: string }> {
    const { where, params } = this.scopedRunFilter(project, from, to, { alias: 'tr' });
    const sql = `
      SELECT t.title AS step, tr.duration AS duration, tr.testId AS testId
      FROM test_runs tr
      JOIN tests t ON t.testId = tr.testId AND t.fileId = tr.fileId AND t.project = tr.project
      ${where}
      ORDER BY tr.duration DESC
      LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(...params, limit) as Array<{
      step: string | null;
      duration: number;
      testId: string;
    }>;
    return rows.map((r) => ({
      step: r.step ?? 'Unknown Test',
      duration: r.duration,
      testId: r.testId,
    }));
  }

  public getSlowCountsByReport(
    project: string | undefined,
    from: string | undefined,
    to: string | undefined,
    threshold: number
  ): Map<string, number> {
    const { where, params } = this.scopedRunFilter(project, from, to);
    const extra = where ? `${where} AND duration > ?` : 'WHERE duration > ?';
    const rows = this.db
      .prepare(`SELECT reportId, COUNT(*) AS count FROM test_runs ${extra} GROUP BY reportId`)
      .all(...params, threshold) as Array<{ reportId: string; count: number }>;
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.reportId, row.count);
    return map;
  }

  public getFlakySummaryInWindow(
    project: string | undefined,
    from: string,
    to: string,
    warningThreshold: number
  ): { total: number; flakyCount: number } {
    const scoped = project && project !== 'all';
    const projectClauseInWindow = scoped ? 'AND project = ?' : '';

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(DISTINCT testId) AS total FROM test_runs
         WHERE outcome != 'skipped' AND createdAt >= ? AND createdAt < ? ${projectClauseInWindow}`
      )
      .get(...(scoped ? [from, to, project] : [from, to])) as { total: number };

    const flakyRow = this.db
      .prepare(
        `SELECT COUNT(DISTINCT iw.testId) AS flakyCount
         FROM (
           SELECT DISTINCT testId, fileId, project FROM test_runs
           WHERE outcome != 'skipped' AND createdAt >= ? AND createdAt < ? ${projectClauseInWindow}
         ) iw
         JOIN tests t USING (testId, fileId, project)
         WHERE COALESCE(t.flakinessScore, 0) >= ?`
      )
      .get(...(scoped ? [from, to, project, warningThreshold] : [from, to, warningThreshold])) as {
      flakyCount: number;
    };

    return { total: totalRow?.total ?? 0, flakyCount: flakyRow?.flakyCount ?? 0 };
  }

  public getTestRunsInWindow(project: string | undefined, from: string, to: string): TestRun[] {
    const conditions: string[] = ["tr.outcome != 'skipped'"];
    const params: string[] = [];

    conditions.push('tr.createdAt >= ?');
    params.push(from);
    conditions.push('tr.createdAt < ?');
    params.push(to);

    if (project && project !== 'all') {
      conditions.push('tr.project = ?');
      params.push(project);
    }

    const sql = `
      SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber
      FROM test_runs tr
      LEFT JOIN reports r ON r.reportID = tr.reportId
      WHERE ${conditions.join(' AND ')}
      ORDER BY tr.createdAt DESC
    `;
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((row) => this.convertDbRowToTestRun(row));
  }

  public updateFlakinessScore(runId: string, score: number): void {
    this.updateFlakinessScoreStmt.run(score, runId);
  }

  public getTestRunsByReport(reportId: string): TestRun[] {
    const rows = this.db
      .prepare('SELECT * FROM test_runs WHERE reportId = ? ORDER BY createdAt DESC')
      .all(reportId);
    return rows.map((row) => this.convertDbRowToTestRun(row));
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
    project: string,
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
         WHERE testId = ? AND fileId = ? AND project = ?
           AND error_signature = ? AND reportId != ?`
      )
      .get(testId, fileId, project, errorSignature, excludeReportId) as { c: number };
    // Join with reports so the UI can display the user-friendly number + title
    // instead of a sliced UUID. Left-join is unnecessary — every test_run
    // FK-points at an existing report row.
    const firstRow = this.db
      .prepare(
        `SELECT tr.reportId, tr.createdAt, r.displayNumber, r.title
         FROM test_runs tr
         JOIN reports r ON r.reportID = tr.reportId
         WHERE tr.testId = ? AND tr.fileId = ? AND tr.project = ?
           AND tr.error_signature = ? AND tr.reportId != ?
         ORDER BY tr.createdAt ASC
         LIMIT 1`
      )
      .get(testId, fileId, project, errorSignature, excludeReportId) as
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
      failure_details: string | null;
    }>;
    if (rows.length === 0) return 0;

    let updated = 0;
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        if (!row.failure_details) continue;
        let message = '';
        try {
          message = String((JSON.parse(row.failure_details) as { message?: string }).message ?? '');
        } catch {
          continue;
        }
        if (!message) continue;
        const signature = computeSignature(message);
        this.backfillGlobalSignatureStmt.run(signature, row.runId);
        updated++;
      }
    });
    tx();
    return updated;
  }

  public clear(): void {
    this.db.prepare('DELETE FROM test_runs').run();
    this.db.prepare('DELETE FROM tests').run();
  }

  public runTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export const testDb = TestDatabase.getInstance();
