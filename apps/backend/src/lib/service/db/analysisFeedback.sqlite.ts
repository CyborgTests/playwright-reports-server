import { randomUUID as uuid } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';

const initiatedAnalysisFeedbackDb = Symbol.for('playwright.reports.db.analysisFeedback');
const instance = globalThis as typeof globalThis & {
  [initiatedAnalysisFeedbackDb]?: AnalysisFeedbackDatabase;
};

export interface AnalysisFeedbackRow {
  id: string;
  testId: string | null;
  fileId: string | null;
  project: string;
  reportId: string | null;
  errorSignature: string | null;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export class AnalysisFeedbackDatabase {
  private readonly db = getDatabase();

  private readonly getByTestStmt: Database.Statement<[string, string, string]>;
  private readonly insertStmt: Database.Statement<
    [string, string, string, string, string | null, string | null, string, string, string]
  >;
  private readonly updateCommentStmt: Database.Statement<[string, string, string]>;
  private readonly deleteByTestStmt: Database.Statement<[string, string, string]>;
  private readonly perTestForReportStmt: Database.Statement<[string, number]>;

  private constructor() {
    this.getByTestStmt = this.db.prepare(`
      SELECT * FROM analysis_feedback
      WHERE testId = ? AND fileId = ? AND project = ?
    `);

    this.insertStmt = this.db.prepare(`
      INSERT INTO analysis_feedback
        (id, testId, fileId, project, reportId, errorSignature, comment, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.updateCommentStmt = this.db.prepare(`
      UPDATE analysis_feedback SET comment = ?, updatedAt = ? WHERE id = ?
    `);

    this.deleteByTestStmt = this.db.prepare(`
      DELETE FROM analysis_feedback
      WHERE testId = ? AND fileId = ? AND project = ?
    `);

    this.perTestForReportStmt = this.db.prepare(`
      SELECT af.* FROM analysis_feedback af
      INNER JOIN (
        SELECT DISTINCT testId, fileId, project FROM test_runs WHERE reportId = ?
      ) tr ON af.testId = tr.testId AND af.fileId = tr.fileId AND af.project = tr.project
      ORDER BY af.updatedAt DESC
      LIMIT ?
    `);
  }

  public static getInstance(): AnalysisFeedbackDatabase {
    instance[initiatedAnalysisFeedbackDb] ??= new AnalysisFeedbackDatabase();
    return instance[initiatedAnalysisFeedbackDb];
  }

  public getByTest(testId: string, fileId: string, project: string): AnalysisFeedbackRow | null {
    return (
      (this.getByTestStmt.get(testId, fileId, project) as AnalysisFeedbackRow | undefined) ?? null
    );
  }

  public upsertTest(params: {
    testId: string;
    fileId: string;
    project: string;
    comment: string;
    originReportId?: string;
    errorSignature?: string;
  }): AnalysisFeedbackRow {
    const { testId, fileId, project, comment, originReportId, errorSignature } = params;
    const now = new Date().toISOString();

    const upsert = this.db.transaction((): AnalysisFeedbackRow => {
      const existing = this.getByTest(testId, fileId, project);
      if (existing) {
        this.updateCommentStmt.run(comment, now, existing.id);
        return { ...existing, comment, updatedAt: now };
      }
      const id = uuid();
      this.insertStmt.run(
        id,
        testId,
        fileId,
        project,
        originReportId ?? null,
        errorSignature ?? null,
        comment,
        now,
        now
      );
      return {
        id,
        testId,
        fileId,
        project,
        reportId: originReportId ?? null,
        errorSignature: errorSignature ?? null,
        comment,
        createdAt: now,
        updatedAt: now,
      };
    });

    return upsert();
  }

  public deleteByTest(testId: string, fileId: string, project: string): void {
    this.deleteByTestStmt.run(testId, fileId, project);
  }

  public getPerTestForReport(reportId: string, limit = 10): AnalysisFeedbackRow[] {
    return this.perTestForReportStmt.all(reportId, limit) as AnalysisFeedbackRow[];
  }

  /**
   * Phase 2: same-test feedback in other projects, optionally enriched with the latest
   * persisted analysis for that test in that project. Caller computes the signature-match
   * flag against the current test_run's errorSignature.
   */
  public getRelatedByTest(
    testId: string,
    fileId: string,
    excludeProject: string,
    limit = 5
  ): RelatedFeedbackRow[] {
    return this.db
      .prepare(
        `SELECT
           af.*,
           tla.analysis        AS latestAnalysis,
           tla.lastAnalysisAt  AS latestAnalysisUpdatedAt,
           tla.model           AS latestAnalysisModel
         FROM analysis_feedback af
         LEFT JOIN (
           SELECT testId, fileId, project, analysis, model,
                  COALESCE(updatedAt, createdAt) AS lastAnalysisAt,
                  ROW_NUMBER() OVER (
                    PARTITION BY testId, fileId, project
                    ORDER BY COALESCE(updatedAt, createdAt) DESC, attempt DESC
                  ) AS rn
           FROM test_llm_analyses
           WHERE analysis IS NOT NULL
         ) tla ON tla.testId = af.testId
              AND tla.fileId = af.fileId
              AND tla.project = af.project
              AND tla.rn = 1
         WHERE af.testId = ?
           AND af.fileId = ?
           AND af.project != ?
         ORDER BY af.updatedAt DESC
         LIMIT ?`
      )
      .all(testId, fileId, excludeProject, limit) as RelatedFeedbackRow[];
  }
}

type RelatedFeedbackRow = AnalysisFeedbackRow & {
  latestAnalysis: string | null;
  latestAnalysisUpdatedAt: string | null;
  latestAnalysisModel: string | null;
};

export const analysisFeedbackDb = AnalysisFeedbackDatabase.getInstance();
