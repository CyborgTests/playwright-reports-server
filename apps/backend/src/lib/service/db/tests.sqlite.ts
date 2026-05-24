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

  /**
   * A test is considered flaky when its latest run's `flakinessScore` is at or above the
   * provided warning threshold. `total` counts unique testIds (so the same test running
   * across multiple Playwright projects/browsers is counted once).
   */
  public getTestsSummary(
    project: string | undefined,
    warningThreshold: number
  ): { total: number; flakyTests: TestWithQuarantineInfo[] } {
    const tests = project ? this.getTestsByProject(project) : this.getAllTests();
    const flaky: TestWithQuarantineInfo[] = [];
    const uniqueTestIds = new Set<string>();

    for (const test of tests) {
      uniqueTestIds.add(test.testId);
      const latestRun = this.getLatestTestRun(test.testId, test.fileId, test.project);
      if (latestRun?.flakinessScore !== undefined && latestRun.flakinessScore >= warningThreshold) {
        flaky.push({
          ...test,
          flakinessScore: latestRun.flakinessScore,
          isQuarantined: latestRun.quarantined || false,
        });
      }
    }

    return { total: uniqueTestIds.size, flakyTests: flaky };
  }

  public getTestRunOutcomesInWindow(
    project: string | undefined,
    from: string,
    to: string
  ): Array<{ testId: string; fileId: string; project: string; outcome: ReportTestOutcomeEnum }> {
    const conditions: string[] = ["outcome != 'skipped'"];
    const params: string[] = [];

    conditions.push('datetime(createdAt) >= datetime(?)');
    params.push(from);
    conditions.push('datetime(createdAt) < datetime(?)');
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

  public getTestRunsInWindow(project: string | undefined, from: string, to: string): TestRun[] {
    const conditions: string[] = ["tr.outcome != 'skipped'"];
    const params: string[] = [];

    conditions.push('datetime(tr.createdAt) >= datetime(?)');
    params.push(from);
    conditions.push('datetime(tr.createdAt) < datetime(?)');
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
