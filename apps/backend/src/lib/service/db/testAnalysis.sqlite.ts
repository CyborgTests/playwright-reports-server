import { randomUUID as uuid } from 'node:crypto';
import { sql } from 'kysely';
import { linkifyReportRefs } from '../../llm/linkifyReportRefs.js';
import { getDatabase } from './db.js';
import { getKysely, type TestLlmAnalysesRow } from './kysely.js';
import { singletonOf } from './singleton.js';

export type TestAnalysisRow = TestLlmAnalysesRow;

export interface TestAnalysisExtras {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export class TestAnalysisDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

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
    const linkifiedAnalysis = analysis ? linkifyReportRefs(analysis, { project }) : null;

    const compiled = this.k
      .insertInto('test_llm_analyses')
      .values({
        id,
        testId,
        fileId,
        project,
        reportId,
        attempt,
        analysis: linkifiedAnalysis,
        category: category ?? null,
        model: model ?? null,
        createdAt: now,
        updatedAt: now,
        reusedFromAnalysisId: reusedFromAnalysisId ?? null,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['testId', 'fileId', 'project', 'reportId', 'attempt']).doUpdateSet((eb) => ({
          analysis: eb.ref('excluded.analysis'),
          category: eb.ref('excluded.category'),
          model: eb.ref('excluded.model'),
          updatedAt: eb.ref('excluded.updatedAt'),
          reusedFromAnalysisId: eb.ref('excluded.reusedFromAnalysisId'),
          inputTokens: eb.ref('excluded.inputTokens'),
          outputTokens: eb.ref('excluded.outputTokens'),
          totalTokens: eb.ref('excluded.totalTokens'),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);

    return {
      id,
      testId,
      fileId,
      project,
      reportId,
      attempt,
      analysis: linkifiedAnalysis,
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
    const compiled = this.k
      .selectFrom('test_llm_analyses')
      .selectAll()
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | TestAnalysisRow
      | undefined;
    return row ?? null;
  }

  /**
   * Find analysis by testId + reportId — precise lookup for a specific test run.
   * Returns the most recently updated row (latest attempt wins on ties).
   */
  public getByTestAndReport(testId: string, reportId: string): TestAnalysisRow | null {
    const compiled = this.k
      .selectFrom('test_llm_analyses')
      .selectAll()
      .where('testId', '=', testId)
      .where('reportId', '=', reportId)
      .orderBy(sql`COALESCE(updatedAt, createdAt)`, 'desc')
      .orderBy('attempt', 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | TestAnalysisRow
      | undefined;
    return row ?? null;
  }

  /**
   * Latest completed analysis for this (testId, fileId, project) from any
   * report OTHER than `excludeReportId`.
   */
  public getLatestPriorByTest(
    testId: string,
    fileId: string,
    project: string,
    excludeReportId: string
  ): TestAnalysisRow | null {
    const compiled = this.k
      .selectFrom('test_llm_analyses')
      .selectAll()
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .where('reportId', '!=', excludeReportId)
      .where('analysis', 'is not', null)
      .where(sql`TRIM(analysis)`, '!=', '')
      .orderBy(sql`COALESCE(updatedAt, createdAt)`, 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | TestAnalysisRow
      | undefined;
    return row ?? null;
  }

  public getByReport(reportId: string): TestAnalysisRow[] {
    const compiled = this.k
      .selectFrom('test_llm_analyses')
      .selectAll()
      .where('reportId', '=', reportId)
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as TestAnalysisRow[];
  }

  public deleteByReport(reportId: string): void {
    const compiled = this.k
      .deleteFrom('test_llm_analyses')
      .where('reportId', '=', reportId)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteByReportIds(reportIds: string[]): void {
    if (reportIds.length === 0) return;
    const compiled = this.k
      .deleteFrom('test_llm_analyses')
      .where('reportId', 'in', reportIds)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteByTest(testId: string, fileId: string, project: string): void {
    const compiled = this.k
      .deleteFrom('test_llm_analyses')
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('project', '=', project)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public findReuseSource(
    testId: string,
    fileId: string,
    project: string,
    errorSignature: string,
    failureCategory: string,
    excludeReportId: string
  ): {
    id: string;
    reportId: string;
    analysis: string;
    category: string | null;
    model: string | null;
    createdAt: string;
    updatedAt: string | null;
  } | null {
    const compiled = this.k
      .selectFrom('test_llm_analyses as tla')
      .innerJoin('test_runs as tr', (join) =>
        join
          .onRef('tr.testId', '=', 'tla.testId')
          .onRef('tr.fileId', '=', 'tla.fileId')
          .onRef('tr.project', '=', 'tla.project')
          .onRef('tr.reportId', '=', 'tla.reportId')
      )
      .select([
        'tla.id',
        'tla.reportId',
        'tla.analysis',
        'tla.category',
        'tla.model',
        'tla.createdAt',
        'tla.updatedAt',
      ])
      .where('tla.testId', '=', testId)
      .where('tla.fileId', '=', fileId)
      .where('tla.project', '=', project)
      .where('tr.error_signature', '=', errorSignature)
      .where('tr.failure_category', '=', failureCategory)
      .where('tla.analysis', 'is not', null)
      .where(sql`TRIM(tla.analysis)`, '!=', '')
      .where('tla.reportId', '!=', excludeReportId)
      .orderBy(sql`COALESCE(tla.updatedAt, tla.createdAt)`, 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | {
          id: string;
          reportId: string;
          analysis: string;
          category: string | null;
          model: string | null;
          createdAt: string;
          updatedAt: string | null;
        }
      | undefined;
    return row ?? null;
  }

  public deleteAll(): void {
    const compiled = this.k.deleteFrom('test_llm_analyses').compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }
}

export const testAnalysisDb = singletonOf('testAnalysis', () => new TestAnalysisDatabase());
