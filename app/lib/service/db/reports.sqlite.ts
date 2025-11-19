import Database from 'better-sqlite3';

import { withError } from '../../withError';

import { getDatabase } from './db';

import { storage } from '@/app/lib/storage';
import { type ReportHistory } from '@/app/lib/storage/types';
import { env } from '@/app/config/env';

const initiatedReportsDb = Symbol.for('playwright.reports.db.reports');
const instance = globalThis as typeof globalThis & { [initiatedReportsDb]?: ReportCache };

export class ReportCache {
  public initialized = false;
  private readonly db = getDatabase();

  private readonly insertStmt: Database.Statement<
    [string, string, string | null, string, string, string | null, number, string | null, string]
  >;
  private readonly updateStmt: Database.Statement<
    [string, string | null, string, string | null, number, string | null, string, string]
  >;
  private readonly deleteStmt: Database.Statement<[string]>;
  private readonly getByIDStmt: Database.Statement<[string]>;
  private readonly getAllStmt: Database.Statement<[]>;
  private readonly getByProjectStmt: Database.Statement<[string]>;
  private readonly searchStmt: Database.Statement<[string, string, string, string]>;

  private constructor() {
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO reports (reportID, project, title, createdAt, reportUrl, size, sizeBytes, stats, metadata, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    this.updateStmt = this.db.prepare(`
      UPDATE reports
      SET project = ?, title = ?, reportUrl = ?, size = ?, sizeBytes = ?, stats = ?, metadata = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE reportID = ?
    `);

    this.deleteStmt = this.db.prepare('DELETE FROM reports WHERE reportID = ?');

    this.getByIDStmt = this.db.prepare('SELECT * FROM reports WHERE reportID = ?');

    this.getAllStmt = this.db.prepare('SELECT * FROM reports ORDER BY createdAt DESC');

    this.getByProjectStmt = this.db.prepare('SELECT * FROM reports WHERE project = ? ORDER BY createdAt DESC');

    this.searchStmt = this.db.prepare(`
      SELECT * FROM reports
      WHERE title LIKE ? OR reportID LIKE ? OR project LIKE ? OR metadata LIKE ?
      ORDER BY createdAt DESC
    `);
  }

  public static getInstance() {
    instance[initiatedReportsDb] ??= new ReportCache();

    return instance[initiatedReportsDb];
  }

  public async init() {
    if (this.initialized || !env.USE_SERVER_CACHE) {
      return;
    }

    console.log('[report db] initializing SQLite for reports');
    const { result, error } = await withError(storage.readReports());

    if (error) {
      console.error('[report db] failed to read reports:', error);

      return;
    }

    if (!result?.reports?.length) {
      console.log('[report db] no reports to store');
      this.initialized = true;

      return;
    }

    console.log(`[report db] caching ${result.reports.length} reports`);

    const insertMany = this.db.transaction((reports: ReportHistory[]) => {
      for (const report of reports) {
        this.insertReport(report);
      }
    });

    insertMany(result.reports as ReportHistory[]);

    this.initialized = true;
    console.log('[report db] initialization complete');
  }

  private insertReport(report: ReportHistory): void {
    const { reportID, project, title, createdAt, reportUrl, size, sizeBytes, stats, ...metadata } = report;

    this.insertStmt.run(
      reportID,
      project || '',
      title || null,
      createdAt.toDateString(),
      reportUrl,
      size || null,
      sizeBytes || 0,
      stats ? JSON.stringify(stats) : null,
      JSON.stringify(metadata),
    );
  }

  public onDeleted(reportIds: string[]) {
    if (!env.USE_SERVER_CACHE) {
      return;
    }

    console.log(`[report db] deleting ${reportIds.length} reports`);

    const deleteMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        this.deleteStmt.run(id);
      }
    });

    deleteMany(reportIds);
  }

  public onCreated(report: ReportHistory) {
    if (!env.USE_SERVER_CACHE) {
      return;
    }

    console.log(`[report db] adding report ${report.reportID}`);
    this.insertReport(report);
  }

  public onUpdated(report: ReportHistory) {
    if (!env.USE_SERVER_CACHE) {
      return;
    }

    console.log(`[report db] updating report ${report.reportID}`);
    const { reportID, project, title, reportUrl, size, sizeBytes, stats, ...metadata } = report;

    this.updateStmt.run(
      project || '',
      title || null,
      reportUrl,
      size || null,
      sizeBytes || 0,
      stats ? JSON.stringify(stats) : null,
      JSON.stringify(metadata),
      reportID,
    );
  }

  public getAll(): ReportHistory[] {
    const rows = this.getAllStmt.all() as Array<{
      reportID: string;
      project: string;
      title: string | null;
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

  public getByProject(project: string): ReportHistory[] {
    const rows = this.getByProjectStmt.all(project) as Array<{
      reportID: string;
      project: string;
      title: string | null;
      createdAt: string;
      reportUrl: string;
      size: string | null;
      sizeBytes: number;
      stats: string | null;
      metadata: string;
    }>;

    return rows.map(this.rowToReport);
  }

  public search(query: string): ReportHistory[] {
    const searchPattern = `%${query}%`;
    const rows = this.searchStmt.all(searchPattern, searchPattern, searchPattern, searchPattern) as Array<{
      reportID: string;
      project: string;
      title: string | null;
      createdAt: string;
      reportUrl: string;
      size: string | null;
      sizeBytes: number;
      stats: string | null;
      metadata: string;
    }>;

    return rows.map(this.rowToReport);
  }

  public getCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM reports').get() as { count: number };

    return result.count;
  }

  public clear(): void {
    console.log('[report db] clearing all reports');
    this.db.prepare('DELETE FROM reports').run();
  }

  private rowToReport(row: {
    reportID: string;
    project: string;
    title: string | null;
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
      createdAt: row.createdAt,
      reportUrl: row.reportUrl,
      size: row.size || undefined,
      sizeBytes: row.sizeBytes,
      stats,
      ...metadata,
    };
  }
}

export const reportDb = ReportCache.getInstance();
