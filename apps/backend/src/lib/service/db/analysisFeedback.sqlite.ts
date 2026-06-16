import { randomUUID as uuid } from 'node:crypto';
import { sql } from 'kysely';
import { getDatabase } from './db.js';
import { type AnalysisFeedbackTableRow, getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';
import { chunk } from './utils.js';

export type AnalysisFeedbackRow = AnalysisFeedbackTableRow;

export class AnalysisFeedbackDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public getByTest(testId: string, fileId: string, project: string): AnalysisFeedbackRow | null {
    const compiled = this.k
      .selectFrom('analysis_feedback')
      .selectAll()
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | AnalysisFeedbackRow
      | undefined;
    return row ?? null;
  }

  public getByTests(
    keys: Array<{ testId: string; fileId: string; project: string }>
  ): Map<string, AnalysisFeedbackRow> {
    const out = new Map<string, AnalysisFeedbackRow>();
    if (keys.length === 0) return out;
    for (const part of chunk(keys, 300)) {
      const tuples = part.map(() => '(?, ?, ?)').join(', ');
      const params = part.flatMap((k) => [k.testId, k.fileId, k.project]);
      const sqlText = `SELECT * FROM analysis_feedback
        WHERE (testId, fileId, project) IN (VALUES ${tuples})`;
      const rows = this.db.prepare(sqlText).all(...params) as AnalysisFeedbackRow[];
      for (const row of rows) {
        out.set(`${row.testId}::${row.fileId}::${row.project}`, row);
      }
    }
    return out;
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
        const updateCompiled = this.k
          .updateTable('analysis_feedback')
          .set({ comment, updatedAt: now })
          .where('id', '=', existing.id)
          .compile();
        this.db.prepare(updateCompiled.sql).run(...updateCompiled.parameters);
        return { ...existing, comment, updatedAt: now };
      }
      const id = uuid();
      const insertCompiled = this.k
        .insertInto('analysis_feedback')
        .values({
          id,
          testId,
          fileId,
          project,
          reportId: originReportId ?? null,
          errorSignature: errorSignature ?? null,
          comment,
          createdAt: now,
          updatedAt: now,
        })
        .compile();
      this.db.prepare(insertCompiled.sql).run(...insertCompiled.parameters);
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
    const compiled = this.k
      .deleteFrom('analysis_feedback')
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getRelatedByTest(
    testId: string,
    fileId: string,
    excludeProject: string,
    limit = 5
  ): RelatedFeedbackRow[] {
    const compiled = this.k
      .selectFrom('analysis_feedback as af')
      .leftJoin(
        sql<{
          testId: string;
          fileId: string;
          project: string;
          analysis: string | null;
          model: string | null;
          lastAnalysisAt: string;
          rn: number;
        }>`(
          SELECT testId, fileId, project, analysis, model,
                 COALESCE(updatedAt, createdAt) AS lastAnalysisAt,
                 ROW_NUMBER() OVER (
                   PARTITION BY testId, fileId, project
                   ORDER BY COALESCE(updatedAt, createdAt) DESC, attempt DESC
                 ) AS rn
          FROM test_llm_analyses
          WHERE analysis IS NOT NULL
        )`.as('tla'),
        (join) =>
          join
            .onRef('tla.testId', '=', 'af.testId')
            .onRef('tla.fileId', '=', 'af.fileId')
            .onRef('tla.project', '=', 'af.project')
            .on('tla.rn', '=', 1)
      )
      .select([
        sql<string>`af.id`.as('id'),
        sql<string>`af.testId`.as('testId'),
        sql<string>`af.fileId`.as('fileId'),
        sql<string>`af.project`.as('project'),
        sql<string | null>`af.reportId`.as('reportId'),
        sql<string | null>`af.errorSignature`.as('errorSignature'),
        sql<string>`af.comment`.as('comment'),
        sql<string>`af.createdAt`.as('createdAt'),
        sql<string>`af.updatedAt`.as('updatedAt'),
        sql<string | null>`tla.analysis`.as('latestAnalysis'),
        sql<string | null>`tla.lastAnalysisAt`.as('latestAnalysisUpdatedAt'),
        sql<string | null>`tla.model`.as('latestAnalysisModel'),
      ])
      .where('af.testId', '=', testId)
      .where('af.fileId', '=', fileId)
      .where('af.project', '!=', excludeProject)
      .orderBy('af.updatedAt', 'desc')
      .limit(limit)
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as RelatedFeedbackRow[];
  }
}

type RelatedFeedbackRow = AnalysisFeedbackRow & {
  latestAnalysis: string | null;
  latestAnalysisUpdatedAt: string | null;
  latestAnalysisModel: string | null;
};

export const analysisFeedbackDb = singletonOf(
  'analysisFeedback',
  () => new AnalysisFeedbackDatabase()
);
