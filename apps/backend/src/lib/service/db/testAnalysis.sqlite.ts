import type Database from 'better-sqlite3';
import { randomUUID as uuid } from 'node:crypto';
import { getDatabase } from './db.js';

const initiatedTestAnalysisDb = Symbol.for('playwright.reports.db.testAnalysis');
const instance = globalThis as typeof globalThis & {
  [initiatedTestAnalysisDb]?: TestAnalysisDatabase;
};

export interface TestAnalysisRow {
  id: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  attempt: number;
  analysis: string | null;
  category: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** Set to the source analysis id when this row was copied from a prior analysis
   *  (same error_signature). NULL for fresh LLM-generated analyses. */
  reusedFromAnalysisId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface TestAnalysisExtras {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export class TestAnalysisDatabase {
  private readonly db = getDatabase();

  private readonly upsertStmt: Database.Statement<
    [
      string,
      string,
      string,
      string,
      string,
      number,
      string | null,
      string | null,
      string | null,
      string,
      string,
      string | null,
      number | null,
      number | null,
      number | null,
    ]
  >;
  private readonly getByTestStmt: Database.Statement<[string, string, string]>;
  private readonly getByReportStmt: Database.Statement<[string]>;
  private readonly deleteByReportStmt: Database.Statement<[string]>;
  private readonly deleteByTestStmt: Database.Statement<[string, string, string]>;

  private constructor() {
    this.upsertStmt = this.db.prepare(`
      INSERT INTO test_llm_analyses (id, testId, fileId, project, reportId, attempt, analysis, category, model, createdAt, updatedAt, reusedFromAnalysisId, inputTokens, outputTokens, totalTokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(testId, fileId, project, reportId, attempt) DO UPDATE SET
        analysis = excluded.analysis,
        category = excluded.category,
        model = excluded.model,
        updatedAt = excluded.updatedAt,
        reusedFromAnalysisId = excluded.reusedFromAnalysisId,
        inputTokens = excluded.inputTokens,
        outputTokens = excluded.outputTokens,
        totalTokens = excluded.totalTokens
    `);

    this.getByTestStmt = this.db.prepare(`
      SELECT * FROM test_llm_analyses WHERE testId = ? AND fileId = ? AND project = ?
    `);

    this.getByReportStmt = this.db.prepare(`
      SELECT * FROM test_llm_analyses WHERE reportId = ?
    `);

    this.deleteByReportStmt = this.db.prepare(`
      DELETE FROM test_llm_analyses WHERE reportId = ?
    `);

    this.deleteByTestStmt = this.db.prepare(`
      DELETE FROM test_llm_analyses WHERE testId = ? AND fileId = ? AND project = ?
    `);
  }

  public static getInstance(): TestAnalysisDatabase {
    instance[initiatedTestAnalysisDb] ??= new TestAnalysisDatabase();
    return instance[initiatedTestAnalysisDb];
  }

  public upsert(
    testId: string,
    fileId: string,
    project: string,
    reportId: string,
    analysis?: string,
    category?: string,
    model?: string,
    attempt = 1,
    reusedFromAnalysisId?: string,
    extras?: TestAnalysisExtras
  ): TestAnalysisRow {
    const id = uuid();
    const now = new Date().toISOString();
    const usage = extras?.usage;

    this.upsertStmt.run(
      id,
      testId,
      fileId,
      project,
      reportId,
      attempt,
      analysis ?? null,
      category ?? null,
      model ?? null,
      now,
      now,
      reusedFromAnalysisId ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.totalTokens ?? null
    );

    return {
      id,
      testId,
      fileId,
      project,
      reportId,
      attempt,
      analysis: analysis ?? null,
      category: category ?? null,
      model: model ?? null,
      createdAt: now,
      updatedAt: now,
      reusedFromAnalysisId: reusedFromAnalysisId ?? null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    };
  }

  public getByTest(testId: string, fileId: string, project: string): TestAnalysisRow | null {
    const row = this.getByTestStmt.get(testId, fileId, project) as TestAnalysisRow | undefined;
    return row ?? null;
  }

  /**
   * Find analysis by testId + reportId — precise lookup for a specific test run.
   * Returns the most recently updated row (latest attempt wins on ties) — when
   * a retry replaces an existing row via ON CONFLICT, the updatedAt advances,
   * so this always surfaces the fresh result. No cross-report fallback: an
   * analysis from a different report is not authoritative for the current
   * one — the served viewer should render an empty state and let the user
   * trigger a fresh analysis instead of seeing "some other analysis".
   */
  public getByTestAndReport(testId: string, reportId: string): TestAnalysisRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM test_llm_analyses
         WHERE testId = ? AND reportId = ?
         ORDER BY COALESCE(updatedAt, createdAt) DESC, attempt DESC
         LIMIT 1`
      )
      .get(testId, reportId) as TestAnalysisRow | undefined;
    return row ?? null;
  }

  /**
   * Latest completed analysis for this (testId, fileId, project) from any
   * report OTHER than `excludeReportId`. Used to surface the prior-run
   * diagnosis into the next analysis prompt without echoing the model its own
   * conclusion. Only rows with non-empty `analysis` text are returned.
   */
  public getLatestPriorByTest(
    testId: string,
    fileId: string,
    project: string,
    excludeReportId: string
  ): TestAnalysisRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM test_llm_analyses
         WHERE testId = ? AND fileId = ? AND project = ?
           AND reportId != ?
           AND analysis IS NOT NULL AND TRIM(analysis) != ''
         ORDER BY COALESCE(updatedAt, createdAt) DESC
         LIMIT 1`
      )
      .get(testId, fileId, project, excludeReportId) as TestAnalysisRow | undefined;
    return row ?? null;
  }

  /**
   * Get all analyses for a test in a specific report (one per attempt).
   */
  public getAllByTestAndReport(testId: string, reportId: string): TestAnalysisRow[] {
    return this.db
      .prepare('SELECT * FROM test_llm_analyses WHERE testId = ? AND reportId = ? ORDER BY attempt')
      .all(testId, reportId) as TestAnalysisRow[];
  }

  public getByReport(reportId: string): TestAnalysisRow[] {
    return this.getByReportStmt.all(reportId) as TestAnalysisRow[];
  }

  public deleteByReport(reportId: string): void {
    this.deleteByReportStmt.run(reportId);
  }

  public deleteByReportIds(reportIds: string[]): void {
    if (reportIds.length === 0) return;
    const placeholders = reportIds.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM test_llm_analyses WHERE reportId IN (${placeholders})`)
      .run(...reportIds);
  }

  public deleteByTest(testId: string, fileId: string, project: string): void {
    this.deleteByTestStmt.run(testId, fileId, project);
  }
}

export const testAnalysisDb = TestAnalysisDatabase.getInstance();
