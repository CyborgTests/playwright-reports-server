import type { ReportTestOutcomeEnum } from '@playwright-reports/shared';
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
  errorSignature?: string;
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

export class TestDatabase {
  private readonly db = getDatabase();

  private convertDbRowToTestRun(row: any): TestRun {
    return {
      ...row,
      quarantined: Boolean(row.quarantined),
      failureDetails: row.failure_details || undefined,
      failureCategory: row.failure_category || undefined,
      errorSignature: row.error_signature || undefined,
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
    ]
  >;
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
      INSERT INTO test_runs (runId, testId, fileId, project, reportId, outcome, duration, createdAt, flakinessScore, quarantineReason, quarantined, failure_details, failure_category, error_signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      SELECT * FROM test_runs
      WHERE testId = ? AND fileId = ? AND project = ?
      ORDER BY createdAt DESC
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
        AND datetime(createdAt) >= datetime(?)
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
  }

  public static getInstance(): TestDatabase {
    instance[initiatedTestsDb] ??= new TestDatabase();
    return instance[initiatedTestsDb];
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
      // First, find all unique (testId, fileId, project) tuples that have runs for this report
      const affectedTestsStmt = this.db.prepare(`
        SELECT DISTINCT testId, fileId, project FROM test_runs WHERE reportId = ?
      `);
      const affectedTests = affectedTestsStmt.all(reportId) as Array<{
        testId: string;
        fileId: string;
        project: string;
      }>;

      // Delete test runs for this report
      const result = this.deleteTestRunsByReportIdStmt.run(reportId);

      // For each affected test, check if it has any remaining runs
      // If not, delete the test itself
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
      errorSignature: testRunWithId.errorSignature || null,
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
      validatedParams.errorSignature
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
    // Convert boolean to integer for SQLite compatibility
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
    const tests = project ? this.getTestsByProject(project) : this.getAllTests();
    return tests.map((test) => {
      const derived = this.getTestWithDerivedData(test.testId, test.fileId, test.project);
      const runs = this.getTestRuns(test.testId, test.fileId, test.project);
      return {
        ...(derived ?? test),
        runs,
      };
    });
  }

  public getTestsSummary(project?: string): { total: number; flakyTests: TestWithQuarantineInfo[] } {
    const tests = project ? this.getTestsByProject(project) : this.getAllTests();
    const flaky: TestWithQuarantineInfo[] = [];

    for (const test of tests) {
      const latestRun = this.getLatestTestRun(test.testId, test.fileId, test.project);
      if (latestRun?.flakinessScore && latestRun.flakinessScore > 0) {
        flaky.push({
          ...test,
          flakinessScore: latestRun.flakinessScore,
          isQuarantined: latestRun.quarantined || false,
        });
      }
    }

    return { total: tests.length, flakyTests: flaky };
  }

  public updateFlakinessScore(runId: string, score: number): void {
    this.updateFlakinessScoreStmt.run(score, runId);
  }

  public getTestRunsByReport(reportId: string): TestRun[] {
    const rows = this.db.prepare('SELECT * FROM test_runs WHERE reportId = ? ORDER BY createdAt DESC').all(reportId);
    return rows.map((row) => this.convertDbRowToTestRun(row));
  }

  public updateFailureCategory(runId: string, category: string): void {
    this.db.prepare('UPDATE test_runs SET failure_category = ? WHERE runId = ?').run(category, runId);
  }

  public clear(): void {
    console.log('[test db] clearing all test data');
    this.db.prepare('DELETE FROM test_runs').run();
    this.db.prepare('DELETE FROM tests').run();
  }

  public runTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export const testDb = TestDatabase.getInstance();
