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
  analysis: string | null;
  category: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export class TestAnalysisDatabase {
  private readonly db = getDatabase();

  private readonly upsertStmt: Database.Statement<
    [string, string, string, string, string, string | null, string | null, string | null, string, string]
  >;
  private readonly getByTestStmt: Database.Statement<[string, string, string]>;
  private readonly getByReportStmt: Database.Statement<[string]>;
  private readonly deleteByReportStmt: Database.Statement<[string]>;
  private readonly deleteByTestStmt: Database.Statement<[string, string, string]>;

  private constructor() {
    this.upsertStmt = this.db.prepare(`
      INSERT INTO test_llm_analyses (id, testId, fileId, project, reportId, analysis, category, model, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(testId, fileId, project) DO UPDATE SET
        reportId = excluded.reportId,
        analysis = excluded.analysis,
        category = excluded.category,
        model = excluded.model,
        updatedAt = excluded.updatedAt
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
    model?: string
  ): TestAnalysisRow {
    const id = uuid();
    const now = new Date().toISOString();

    this.upsertStmt.run(
      id,
      testId,
      fileId,
      project,
      reportId,
      analysis ?? null,
      category ?? null,
      model ?? null,
      now,
      now
    );

    return {
      id,
      testId,
      fileId,
      project,
      reportId,
      analysis: analysis ?? null,
      category: category ?? null,
      model: model ?? null,
      createdAt: now,
      updatedAt: now,
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
      .prepare('SELECT * FROM test_llm_analyses WHERE testId = ? AND reportId = ? LIMIT 1')
      .get(testId, reportId) as TestAnalysisRow | undefined;
    if (exact) return exact;

    // Fall back to testId only (analysis may have been triggered from a different report)
    const fallback = this.db
      .prepare('SELECT * FROM test_llm_analyses WHERE testId = ? ORDER BY updatedAt DESC, createdAt DESC LIMIT 1')
      .get(testId) as TestAnalysisRow | undefined;
    return fallback ?? null;
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
