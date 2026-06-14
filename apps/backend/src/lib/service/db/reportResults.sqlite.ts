import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

export class ReportResultsDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public linkReportToResults(reportId: string, resultIds: string[]): void {
    if (!resultIds?.length) return;
    const now = new Date().toISOString();
    const compiled = this.k
      .insertInto('report_results')
      .values(resultIds.map((resultId) => ({ reportId, resultId, createdAt: now })))
      .onConflict((oc) => oc.doNothing())
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteByReportIds(reportIds: string[]): void {
    if (!reportIds?.length) return;
    const compiled = this.k
      .deleteFrom('report_results')
      .where('reportId', 'in', reportIds)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteByResultIds(resultIds: string[]): void {
    if (!resultIds?.length) return;
    const compiled = this.k
      .deleteFrom('report_results')
      .where('resultId', 'in', resultIds)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getReportsForResultIds(
    resultIds: string[]
  ): Map<string, Array<{ reportID: string; displayNumber: number | null }>> {
    const out = new Map<string, Array<{ reportID: string; displayNumber: number | null }>>();
    if (!resultIds.length) return out;
    const compiled = this.k
      .selectFrom('report_results as rr')
      .innerJoin('reports as r', 'r.reportID', 'rr.reportId')
      .select(['rr.resultId', 'r.reportID', 'r.displayNumber', 'r.createdAt'])
      .where('rr.resultId', 'in', resultIds)
      .orderBy('r.createdAt', 'desc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      resultId: string;
      reportID: string;
      displayNumber: number | null;
      createdAt: string;
    }>;
    for (const row of rows) {
      const list = out.get(row.resultId) ?? [];
      list.push({ reportID: row.reportID, displayNumber: row.displayNumber });
      out.set(row.resultId, list);
    }
    return out;
  }

  public getCount(): number {
    const compiled = this.k
      .selectFrom('report_results')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as { count: number };
    return row.count;
  }
}

export const reportResultsDb = singletonOf('report_results', () => new ReportResultsDatabase());
