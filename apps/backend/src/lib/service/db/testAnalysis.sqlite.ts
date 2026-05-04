import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
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
    ]
  >;
  private readonly getByTestStmt: Database.Statement<[string, string, string]>;
  private readonly getByReportStmt: Database.Statement<[string]>;
  private readonly deleteByReportStmt: Database.Statement<[string]>;
  private readonly deleteByTestStmt: Database.Statement<[string, string, string]>;

  private constructor() {
    this.upsertStmt = this.db.prepare(`
      INSERT INTO test_llm_analyses (id, testId, fileId, project, reportId, attempt, analysis, category, model, createdAt, updatedAt, reusedFromAnalysisId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(testId, fileId, project, reportId, attempt) DO UPDATE SET
        analysis = excluded.analysis,
        category = excluded.category,
        model = excluded.model,
        updatedAt = excluded.updatedAt,
        reusedFromAnalysisId = excluded.reusedFromAnalysisId
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
    reusedFromAnalysisId?: string
  ): TestAnalysisRow {
    const id = uuid();
    const now = new Date().toISOString();

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
      reusedFromAnalysisId ?? null
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
    };
  }

  public getByTest(testId: string, fileId: string, project: string): TestAnalysisRow | null {
    const row = this.getByTestStmt.get(testId, fileId, project) as TestAnalysisRow | undefined;
    return row ?? null;
  }

  /**
   * Find analysis by testId + reportId — precise lookup for a specific test run.
   * Falls back to testId-only if no match for the specific report.
   */
  public getByTestAndReport(testId: string, reportId: string): TestAnalysisRow | null {
    // Try exact match first: testId + reportId
    const exact = this.db
      .prepare(
        'SELECT * FROM test_llm_analyses WHERE testId = ? AND reportId = ? ORDER BY attempt LIMIT 1'
      )
      .get(testId, reportId) as TestAnalysisRow | undefined;
    if (exact) return exact;

    // Fall back to testId only (analysis may have been triggered from a different report)
    const fallback = this.db
      .prepare(
        'SELECT * FROM test_llm_analyses WHERE testId = ? ORDER BY updatedAt DESC, createdAt DESC LIMIT 1'
      )
      .get(testId) as TestAnalysisRow | undefined;
    return fallback ?? null;
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

  public deleteByTest(testId: string, fileId: string, project: string): void {
    this.deleteByTestStmt.run(testId, fileId, project);
  }
}

export const testAnalysisDb = TestAnalysisDatabase.getInstance();
