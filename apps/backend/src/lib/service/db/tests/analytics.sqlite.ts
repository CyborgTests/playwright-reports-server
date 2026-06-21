import * as testQueries from '../queries/testAnalytics.js';
import { singletonOf } from '../singleton.js';
import { TestDbBase, type TestRunRow } from './shared.js';

export class TestAnalyticsDatabase extends TestDbBase {
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
  public getTestRunsInWindow(project: string | undefined, from: string, to: string): TestRunRow[] {
    return testQueries.getTestRunsInWindow(this.db, project, from, to);
  }
  public getTopFailingTestsInWindow(
    project: string | undefined,
    from: string,
    to: string,
    limit: number
  ): Array<{
    testId: string;
    fileId: string;
    project: string;
    title: string;
    failureCount: number;
  }> {
    return testQueries.getTopFailingTestsInWindow(this.db, project, from, to, limit);
  }
  public getFlakiestTestsInWindow(
    project: string | undefined,
    from: string,
    to: string,
    limit: number,
    minScore: number
  ): Array<{
    testId: string;
    fileId: string;
    project: string;
    title: string;
    flakinessScore: number;
  }> {
    return testQueries.getFlakiestTestsInWindow(this.db, project, from, to, limit, minScore);
  }

  public getCategoryConsensus(
    signature: string
  ): { category: string; share: number; total: number } | null {
    if (!signature) return null;
    const compiled = this.k
      .selectFrom('test_runs')
      .select((eb) => ['failure_category as category', eb.fn.countAll<number>().as('count')])
      .where('error_signature', '=', signature)
      .where('failure_category', 'is not', null)
      .where('failure_category', '!=', 'unknown')
      .groupBy('failure_category')
      .orderBy('count', 'desc')
      .limit(5)
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      category: string;
      count: number;
    }>;
    if (rows.length === 0) return null;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const top = rows[0];
    return { category: top.category, share: top.count / total, total };
  }

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
    const countCompiled = this.k
      .selectFrom('test_runs')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('testId', '=', testId)
      .where('fileId', '=', fileId)
      .where('error_signature', '=', errorSignature)
      .where('reportId', '!=', excludeReportId)
      .compile();
    const countRow = this.db.prepare(countCompiled.sql).get(...countCompiled.parameters) as {
      c: number;
    };
    const firstCompiled = this.k
      .selectFrom('test_runs as tr')
      .innerJoin('reports as r', 'r.reportID', 'tr.reportId')
      .select(['tr.reportId', 'tr.createdAt', 'r.displayNumber', 'r.title'])
      .where('tr.testId', '=', testId)
      .where('tr.fileId', '=', fileId)
      .where('tr.error_signature', '=', errorSignature)
      .where('tr.reportId', '!=', excludeReportId)
      .orderBy('tr.createdAt', 'asc')
      .limit(1)
      .compile();
    const firstRow = this.db.prepare(firstCompiled.sql).get(...firstCompiled.parameters) as
      | { reportId: string; createdAt: string; displayNumber: number | null; title: string | null }
      | undefined;
    return {
      priorOccurrenceCount: countRow?.c ?? 0,
      firstOccurrence: firstRow ?? null,
    };
  }

  public getFailureCategoryCounts(
    project?: string
  ): Array<{ category: string; occurrences: number }> {
    let q = this.k
      .selectFrom('test_runs')
      .select((eb) => ['failure_category as category', eb.fn.countAll<number>().as('occurrences')])
      .where('failure_category', 'is not', null)
      .groupBy('failure_category')
      .orderBy('occurrences', 'desc');
    if (project) q = q.where('project', '=', project);
    const compiled = q.compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      category: string;
      occurrences: number;
    }>;
  }

  public getFailedTestsWithoutAnalysis(): Array<{
    testId: string;
    fileId: string;
    project: string;
    reportId: string;
  }> {
    // NOT EXISTS subquery doesn't compose cleanly into Kysely's builder.
    // Raw SQL fragment is clearer here.
    return this.db
      .prepare(
        `SELECT DISTINCT t.testId, t.fileId, t.project, tr.reportId
         FROM test_runs tr
         JOIN tests t ON tr.testId = t.testId AND tr.fileId = t.fileId AND tr.project = t.project
         WHERE tr.failure_details IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM test_llm_analyses tla
             WHERE tla.testId = tr.testId AND tla.fileId = tr.fileId AND tla.project = tr.project
           )`
      )
      .all() as Array<{ testId: string; fileId: string; project: string; reportId: string }>;
  }
}

export const testAnalyticsDb = singletonOf('testAnalytics', () => new TestAnalyticsDatabase());
