import type Database from 'better-sqlite3';
import { defaultProjectName } from '../../constants.js';
import type { ReadReportsInput, ReadReportsOutput, ReportHistory } from '../../storage/types.js';
import { withError } from '../../withError.js';
import { testManagementService } from '../testManagement.js';
import { getDatabase } from './db.js';
import { testDb } from './tests.sqlite.js';

const initiatedReportsDb = Symbol.for('playwright.reports.db.reports');
const instance = globalThis as typeof globalThis & {
  [initiatedReportsDb]?: ReportDatabase;
};

type ReportRow = {
  reportID: string;
  project: string;
  title: string | null;
  displayNumber: number | null;
  createdAt: string;
  reportUrl: string;
  size: string | null;
  sizeBytes: number;
  stats: string | null;
  metadata: string;
};

export class ReportDatabase {
  public initialized = false;
  private readonly db = getDatabase();

  private readonly insertStmt: Database.Statement<
    [
      string,
      string,
      string | null,
      number | null,
      string,
      string,
      string | null,
      number,
      string | null,
      string,
    ]
  >;
  private readonly deleteStmt: Database.Statement<[string]>;
  private readonly getByIDStmt: Database.Statement<[string]>;
  private readonly getAllStmt: Database.Statement<[]>;
  private readonly getByProjectStmt: Database.Statement<[string]>;
  private readonly searchStmt: Database.Statement<[string, string, string, string]>;
  private readonly getExpiredIdsStmt: Database.Statement<[string, number]>;

  private constructor() {
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO reports (reportID, project, title, displayNumber, createdAt, reportUrl, size, sizeBytes, stats, metadata, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    this.deleteStmt = this.db.prepare('DELETE FROM reports WHERE reportID = ?');

    this.getByIDStmt = this.db.prepare('SELECT * FROM reports WHERE reportID = ?');

    this.getAllStmt = this.db.prepare('SELECT * FROM reports ORDER BY createdAt DESC');

    this.getByProjectStmt = this.db.prepare(
      'SELECT * FROM reports WHERE project = ? ORDER BY createdAt DESC'
    );

    this.searchStmt = this.db.prepare(`
      SELECT * FROM reports
      WHERE title LIKE ? OR reportID LIKE ? OR project LIKE ? OR metadata LIKE ?
      ORDER BY createdAt DESC
    `);

    this.getExpiredIdsStmt = this.db.prepare(`
      SELECT reportID FROM reports
      WHERE datetime(createdAt) < datetime(?)
      ORDER BY datetime(createdAt) ASC
      LIMIT ?
    `);
  }

  public getExpiredIds(cutoffISO: string, limit: number): string[] {
    const rows = this.getExpiredIdsStmt.all(cutoffISO, limit) as Array<{ reportID: string }>;
    return rows.map((row) => row.reportID);
  }

  public static getInstance(): ReportDatabase {
    instance[initiatedReportsDb] ??= new ReportDatabase();
    return instance[initiatedReportsDb];
  }

  public async init() {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    console.log(`[report db] initialized (${this.getCount()} reports)`);
  }

  public async populateTestRuns(): Promise<void> {
    if (!this.initialized) {
      console.warn('[report db] Reports database not initialized, skipping processing');
      return;
    }

    console.log('[report db] Processing existing reports into tests and test runs');

    try {
      const reports = this.getAll();

      if (!reports.length) {
        console.log('[report db] No reports to process');
        return;
      }

      console.log(`[report db] Found ${reports.length} reports to parse`);

      const existingReportIds = this.db
        .prepare('SELECT DISTINCT reportId FROM test_runs')
        .all() as Array<{ reportId: string }>;

      const existingReportIdSet = new Set(existingReportIds.map((row) => row.reportId));

      const unprocessedReports = reports.filter(
        (report) => !existingReportIdSet.has(report.reportID)
      );

      if (!unprocessedReports.length) {
        console.log('[report db] All reports have already been parsed');
        return;
      }

      console.log(`[report db] Processing ${unprocessedReports.length} unprocessed reports`);

      let processedCount = 0;
      let errorCount = 0;

      for (const report of unprocessedReports) {
        const { error } = await withError(testManagementService.processReport(report));

        if (error) {
          console.error(`[report db] Error processing report ${report.reportID}:`, error);
          errorCount++;
        }

        processedCount++;
      }

      console.log(
        `[report db] Processing complete: ${processedCount} reports processed, ${errorCount} errors`
      );
    } catch (error) {
      console.error('[report db] Failed to process existing reports:', error);
      throw error;
    }
  }

  private insertReport(report: ReportHistory): void {
    const {
      reportID,
      project,
      title,
      displayNumber,
      createdAt,
      reportUrl,
      size,
      sizeBytes,
      stats,
      ...metadata
    } = report;

    let createdAtStr: string;
    if (createdAt instanceof Date) {
      createdAtStr = createdAt.toDateString();
    } else if (typeof createdAt === 'string') {
      createdAtStr = createdAt;
    } else {
      createdAtStr = String(createdAt);
    }

    this.insertStmt.run(
      reportID,
      project || '',
      title || null,
      displayNumber || null,
      createdAtStr,
      reportUrl,
      size || null,
      sizeBytes || 0,
      stats ? JSON.stringify(stats) : null,
      JSON.stringify(metadata)
    );
  }

  public onDeleted(reportIds: string[]) {
    const deleteMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        this.deleteStmt.run(id);
      }
    });

    deleteMany(reportIds);

    for (const reportId of reportIds) {
      testDb.deleteTestRunsByReportId(reportId);
    }
  }

  public onCreated(report: ReportHistory) {
    const reportWithDisplayNumber = {
      ...report,
      displayNumber: report.displayNumber ?? this.getNextDisplayNumber(),
    };

    this.insertReport(reportWithDisplayNumber);
  }

  public getAll(): ReportHistory[] {
    const rows = this.getAllStmt.all() as Array<{
      reportID: string;
      project: string;
      title: string | null;
      displayNumber: number | null;
      createdAt: string;
      reportUrl: string;
      size: string | null;
      sizeBytes: number;
      stats: string | null;
      metadata: string;
    }>;

    return rows.map(this.rowToReport);
  }

  public getByID(reportID: string): ReportHistory | undefined {
    const row = this.getByIDStmt.get(reportID) as
      | {
          reportID: string;
          project: string;
          title: string | null;
          displayNumber: number | null;
          createdAt: string;
          reportUrl: string;
          size: string | null;
          sizeBytes: number;
          stats: string | null;
          metadata: string;
        }
      | undefined;

    return row ? this.rowToReport(row) : undefined;
  }

  public getReportHistoryByTestId(testId: string, projectName?: string): ReportHistory[] {
    const searchPattern = `%"testId":"${testId}"%`;
    const projectPattern =
      projectName && projectName !== defaultProjectName ? `%"project":"${projectName}"%` : '%';
    const rows = this.db
      .prepare(
        `
        SELECT * FROM reports
        WHERE metadata LIKE ? AND project LIKE ?
        ORDER BY createdAt DESC
      `
      )
      .all(searchPattern, projectPattern) as {
      reportID: string;
      project: string;
      title: string | null;
      displayNumber: number | null;
      createdAt: string;
      reportUrl: string;
      size: string | null;
      sizeBytes: number;
      stats: string | null;
      metadata: string;
    }[];

    return rows.map(this.rowToReport);
  }

  public getByProject(project?: string, opts?: { from?: string; to?: string }): ReportHistory[] {
    const hasProject = project && project !== defaultProjectName;
    const hasFrom = !!opts?.from;
    const hasTo = !!opts?.to;

    if (!hasFrom && !hasTo) {
      const stmt = hasProject ? this.getByProjectStmt.all(project ?? '') : this.getAllStmt.all();
      return (stmt as ReportRow[]).map(this.rowToReport);
    }

    const conditions: string[] = [];
    const params: string[] = [];
    if (hasProject) {
      conditions.push('project = ?');
      params.push(project ?? '');
    }
    if (hasFrom) {
      conditions.push('datetime(createdAt) >= datetime(?)');
      params.push(opts?.from ?? '');
    }
    if (hasTo) {
      conditions.push('datetime(createdAt) < datetime(?)');
      params.push(opts?.to ?? '');
    }

    const sql = `SELECT * FROM reports WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC`;
    const rows = this.db.prepare(sql).all(...params) as ReportRow[];
    return rows.map(this.rowToReport);
  }

  public search(query: string): ReportHistory[] {
    const searchPattern = `%${query}%`;
    const rows = this.searchStmt.all(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern
    ) as Array<{
      reportID: string;
      project: string;
      title: string | null;
      displayNumber: number | null;
      createdAt: string;
      reportUrl: string;
      size: string | null;
      sizeBytes: number;
      stats: string | null;
      metadata: string;
    }>;

    return rows.map(this.rowToReport);
  }

  public getLatestByProject(project?: string, limit = 10): ReportHistory[] {
    let rows: Array<{
      reportID: string;
      project: string;
      title: string | null;
      displayNumber: number | null;
      createdAt: string;
      reportUrl: string;
      size: string | null;
      sizeBytes: number;
      stats: string | null;
      metadata: string;
    }>;

    if (project && project !== 'all') {
      rows = this.db
        .prepare('SELECT * FROM reports WHERE project = ? ORDER BY createdAt DESC LIMIT ?')
        .all(project, limit) as typeof rows;
    } else {
      rows = this.db
        .prepare('SELECT * FROM reports ORDER BY createdAt DESC LIMIT ?')
        .all(limit) as typeof rows;
    }

    return rows.map(this.rowToReport);
  }

  public getCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM reports').get() as {
      count: number;
    };

    return result.count;
  }

  public clear(): void {
    this.db.prepare('DELETE FROM reports').run();
  }

  public query(input?: ReadReportsInput): ReadReportsOutput {
    let query = 'SELECT * FROM reports';
    const params: string[] = [];
    const conditions: string[] = [];

    if (input?.ids && input.ids.length > 0) {
      conditions.push(`reportID IN (${input.ids.map(() => '?').join(', ')})`);
      params.push(...input.ids);
    }

    if (input?.project && input?.project !== defaultProjectName) {
      conditions.push('project = ?');
      params.push(input.project);
    }

    if (input?.search?.trim()) {
      const searchTerm = `%${input.search.toLowerCase().trim()}%`;

      conditions.push(
        '(LOWER(title) LIKE ? OR LOWER(reportID) LIKE ? OR LOWER(project) LIKE ? OR LOWER(metadata) LIKE ?)'
      );
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY createdAt DESC';

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countResult = this.db.prepare(countQuery).get(...params) as {
      count: number;
    };
    const total = countResult.count;

    if (input?.pagination) {
      query += ' LIMIT ? OFFSET ?';
      params.push(input.pagination.limit.toString(), input.pagination.offset.toString());
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      reportID: string;
      project: string;
      title: string | null;
      displayNumber: number | null;
      createdAt: string;
      reportUrl: string;
      size: string | null;
      sizeBytes: number;
      stats: string | null;
      metadata: string;
    }>;

    return {
      reports: rows.map((row) => this.rowToReport(row)),
      total,
    };
  }

  public getNextDisplayNumber(): number {
    const result = this.db.prepare('SELECT MAX(displayNumber) as maxNumber FROM reports').get() as {
      maxNumber: number | null;
    };

    return (result.maxNumber || 0) + 1;
  }

  private rowToReport(row: {
    reportID: string;
    project: string;
    title: string | null;
    displayNumber: number | null;
    createdAt: string;
    reportUrl: string;
    size: string | null;
    sizeBytes: number;
    stats: string | null;
    metadata: string;
  }): ReportHistory {
    const metadata = JSON.parse(row.metadata || '{}');
    const stats = row.stats ? JSON.parse(row.stats) : undefined;

    return {
      reportID: row.reportID,
      project: row.project,
      title: row.title || undefined,
      displayNumber: row.displayNumber || undefined,
      createdAt: row.createdAt,
      reportUrl: row.reportUrl,
      size: row.size || undefined,
      sizeBytes: row.sizeBytes,
      stats,
      ...metadata,
    };
  }
}

export const reportDb = ReportDatabase.getInstance();
