import { getDatabase } from './db.js';

import { singletonOf } from './singleton.js';
export class ReportResultsDatabase {
  private readonly db = getDatabase();
  private readonly insertStmt = this.db.prepare(
    'INSERT OR IGNORE INTO report_results (reportId, resultId) VALUES (?, ?)'
  );
  private readonly getReportsForResultStmt = this.db.prepare(
    `SELECT r.reportID, r.displayNumber, r.title, r.createdAt
     FROM report_results rr
     JOIN reports r ON r.reportID = rr.reportId
     WHERE rr.resultId = ?
     ORDER BY r.createdAt DESC`
  );

  public linkReportToResults(reportId: string, resultIds: string[]): void {
    if (!resultIds?.length) return;
    const insertMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) this.insertStmt.run(reportId, id);
    });
    insertMany(resultIds);
  }

  public deleteByReportIds(reportIds: string[]): void {
    if (!reportIds?.length) return;
    const placeholders = reportIds.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM report_results WHERE reportId IN (${placeholders})`)
      .run(...reportIds);
  }

  public deleteByResultIds(resultIds: string[]): void {
    if (!resultIds?.length) return;
    const placeholders = resultIds.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM report_results WHERE resultId IN (${placeholders})`)
      .run(...resultIds);
  }

  public getReportsForResult(resultId: string): Array<{
    reportID: string;
    displayNumber: number | null;
    title: string | null;
    createdAt: string;
  }> {
    return this.getReportsForResultStmt.all(resultId) as Array<{
      reportID: string;
      displayNumber: number | null;
      title: string | null;
      createdAt: string;
    }>;
  }

  public getReportsForResultIds(
    resultIds: string[]
  ): Map<string, Array<{ reportID: string; displayNumber: number | null }>> {
    const out = new Map<string, Array<{ reportID: string; displayNumber: number | null }>>();
    if (!resultIds.length) return out;
    const placeholders = resultIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT rr.resultId, r.reportID, r.displayNumber, r.createdAt
         FROM report_results rr
         JOIN reports r ON r.reportID = rr.reportId
         WHERE rr.resultId IN (${placeholders})
         ORDER BY r.createdAt DESC`
      )
      .all(...resultIds) as Array<{
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

  public getUsedResultIds(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT resultId FROM report_results').all() as Array<{
      resultId: string;
    }>;
    return rows.map((r) => r.resultId);
  }

  public getCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM report_results').get() as {
      count: number;
    };
    return row.count;
  }
}

export const reportResultsDb = singletonOf('report_results', () => new ReportResultsDatabase());
