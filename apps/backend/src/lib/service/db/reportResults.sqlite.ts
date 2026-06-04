import { getDatabase } from './db.js';

const initiatedKey = Symbol.for('playwright.reports.db.report_results');
const instance = globalThis as typeof globalThis & {
  [initiatedKey]?: ReportResultsDatabase;
};

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

  public static getInstance(): ReportResultsDatabase {
    instance[initiatedKey] ??= new ReportResultsDatabase();
    return instance[initiatedKey];
  }

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

  /**
   * Backfill missing links for reports created before this table existed.
   * Joins report.metadata.testRun ↔ result.metadata.testRun.
   * Idempotent (INSERT OR IGNORE).
   */
  public backfillFromTestRun(): { reports: number; links: number } {
    const reports = this.db
      .prepare(
        `SELECT reportID, metadata FROM reports
         WHERE reportID NOT IN (SELECT DISTINCT reportId FROM report_results)`
      )
      .all() as Array<{ reportID: string; metadata: string | null }>;

    if (!reports.length) return { reports: 0, links: 0 };

    let linkedCount = 0;
    const link = this.db.transaction((rows: typeof reports) => {
      for (const row of rows) {
        if (!row.metadata) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(row.metadata);
        } catch {
          continue;
        }
        const testRun = parsed.testRun;
        if (typeof testRun !== 'string' || !testRun) continue;

        const matches = this.db
          .prepare('SELECT resultID FROM results WHERE metadata LIKE ?')
          .all(`%"testRun":"${testRun}"%`) as Array<{ resultID: string }>;
        for (const m of matches) {
          this.insertStmt.run(row.reportID, m.resultID);
          linkedCount += 1;
        }
      }
    });
    link(reports);
    return { reports: reports.length, links: linkedCount };
  }
}

export const reportResultsDb = ReportResultsDatabase.getInstance();
