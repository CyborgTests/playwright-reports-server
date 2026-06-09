import type Database from 'better-sqlite3';
import { defaultProjectName } from '../../constants.js';
import type { ReadReportsInput, ReadReportsOutput, ReportHistory } from '../../storage/types.js';
import { withError } from '../../withError.js';
import { testManagementService } from '../testManagement.js';
import { getDatabase } from './db.js';
import { failureSummaryDb } from './failureSummary.sqlite.js';
import { llmTasksDb } from './llmTasks.sqlite.js';
import { testAnalysisDb } from './testAnalysis.sqlite.js';
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
  updatedAt?: string | null;
};

// Cache parsed metadata/stats keyed by (reportID, updatedAt) so list endpoints
// don't re-run JSON.parse on every row of every request. Writes bump
// updatedAt via the insert statement, so stale entries fall off the keyspace.
const PARSE_CACHE_MAX = 5000;
const parseCache = new Map<string, ReportHistory>();
function parseCacheKey(row: ReportRow): string {
  return `${row.reportID}|${row.updatedAt ?? ''}`;
}

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
      WHERE createdAt < ?
      ORDER BY createdAt ASC
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

  public updateMetadata(
    reportIds: string[],
    patch: { project?: string; tags?: Record<string, string>; removeTags?: string[] }
  ): { updated: number; missing: string[] } {
    if (reportIds.length === 0) return { updated: 0, missing: [] };

    const setProject = typeof patch.project === 'string';
    const setTags = patch.tags && Object.keys(patch.tags).length > 0;
    const removeTags = patch.removeTags && patch.removeTags.length > 0;
    if (!setProject && !setTags && !removeTags) {
      return { updated: 0, missing: [] };
    }

    const rows = new Map<string, ReportRow>();
    for (const id of reportIds) {
      const row = this.getByIDStmt.get(id) as ReportRow | undefined;
      if (row) rows.set(id, row);
    }
    const missing = reportIds.filter((id) => !rows.has(id));
    if (missing.length > 0) {
      return { updated: 0, missing };
    }

    const updateStmt = this.db.prepare(
      'UPDATE reports SET project = ?, metadata = ?, updatedAt = CURRENT_TIMESTAMP WHERE reportID = ?'
    );

    const applyAll = this.db.transaction(() => {
      for (const [id, row] of rows) {
        let metadata: Record<string, unknown>;
        try {
          metadata = JSON.parse(row.metadata || '{}') as Record<string, unknown>;
        } catch {
          metadata = {};
        }

        if (patch.tags) {
          for (const [k, v] of Object.entries(patch.tags)) {
            metadata[k] = v;
          }
        }
        if (patch.removeTags) {
          for (const k of patch.removeTags) {
            delete metadata[k];
          }
        }

        const nextProject = setProject ? (patch.project as string) : row.project;
        updateStmt.run(nextProject, JSON.stringify(metadata), id);
      }
    });
    applyAll();

    for (const id of rows.keys()) {
      for (const key of parseCache.keys()) {
        if (key.startsWith(`${id}|`)) parseCache.delete(key);
      }
    }

    return { updated: rows.size, missing: [] };
  }

  public onDeleted(reportIds: string[]) {
    if (reportIds.length === 0) return;

    const CHUNK_SIZE = 500;
    const cascadeDelete = this.db.transaction((ids: string[]) => {
      llmTasksDb.deleteByReportIds(ids);
      testAnalysisDb.deleteByReportIds(ids);
      failureSummaryDb.deleteSummariesByReportIds(ids);
      testDb.deleteTestRunsByReportIds(ids);
      const placeholders = ids.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM reports WHERE reportID IN (${placeholders})`).run(...ids);
      for (const id of ids) {
        for (const key of parseCache.keys()) {
          if (key.startsWith(`${id}|`)) parseCache.delete(key);
        }
      }
    });

    for (let i = 0; i < reportIds.length; i += CHUNK_SIZE) {
      cascadeDelete(reportIds.slice(i, i + CHUNK_SIZE));
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

  public getNewestReportBefore(project: string, beforeISO: string): ReportHistory | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM reports
         WHERE project = ? AND createdAt < ?
         ORDER BY createdAt DESC
         LIMIT 1`
      )
      .get(project, beforeISO) as ReportRow | undefined;
    return row ? this.rowToReport(row) : undefined;
  }

  public getPreviousReportId(reportID: string): string | null {
    const row = this.db
      .prepare(
        `SELECT prev.reportID
         FROM reports cur, reports prev
         WHERE cur.reportID = ?
           AND prev.project = cur.project
           AND prev.createdAt < cur.createdAt
         ORDER BY prev.createdAt DESC
         LIMIT 1`
      )
      .get(reportID) as { reportID: string } | undefined;

    return row?.reportID ?? null;
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
      conditions.push('createdAt >= ?');
      params.push(opts?.from ?? '');
    }
    if (hasTo) {
      conditions.push('createdAt < ?');
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

  /** Latest reports strictly before `beforeCreatedAt` (ISO). Used by the
   *  project-summary trend signal to fetch the prior window. */
  public getLatestByProjectBefore(
    project: string | undefined,
    beforeCreatedAt: string,
    limit: number
  ): ReportHistory[] {
    type Row = {
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
    const rows =
      project && project !== 'all'
        ? (this.db
            .prepare(
              'SELECT * FROM reports WHERE project = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?'
            )
            .all(project, beforeCreatedAt, limit) as Row[])
        : (this.db
            .prepare('SELECT * FROM reports WHERE createdAt < ? ORDER BY createdAt DESC LIMIT ?')
            .all(beforeCreatedAt, limit) as Row[]);
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

    if (input?.from) {
      conditions.push('createdAt >= ?');
      params.push(input.from);
    }

    if (input?.to) {
      conditions.push('createdAt < ?');
      params.push(input.to);
    }

    if (input?.tags && input.tags.length > 0) {
      // Each tag is a "key: value" string; reports store the same shape inside the
      // metadata JSON column (e.g. "branch":"main"). Match on the JSON repr.
      for (const tag of input.tags) {
        const colonIndex = tag.indexOf(':');
        if (colonIndex === -1) {
          conditions.push('LOWER(metadata) LIKE ?');
          params.push(`%${tag.toLowerCase()}%`);
          continue;
        }
        const key = tag.slice(0, colonIndex).trim();
        const value = tag.slice(colonIndex + 1).trim();
        conditions.push('LOWER(metadata) LIKE ?');
        params.push(`%"${key.toLowerCase()}":"${value.toLowerCase()}"%`);
      }
    }

    if (input?.passRate) {
      // pass% = expected / (total - skipped). Reports without stats are excluded.
      const denom =
        "(CAST(json_extract(stats, '$.total') AS REAL) - COALESCE(CAST(json_extract(stats, '$.skipped') AS REAL), 0))";
      const numer = "CAST(json_extract(stats, '$.expected') AS REAL)";
      const passExpr = `(${numer} * 100.0 / NULLIF(${denom}, 0))`;
      if (input.passRate === 'passing') {
        conditions.push(`${passExpr} >= 100`);
      } else if (input.passRate === 'failing') {
        conditions.push(`${passExpr} < 100`);
      } else if (input.passRate === 'below-threshold') {
        conditions.push(`${passExpr} < 70`);
      }
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

  private rowToReport(row: ReportRow): ReportHistory {
    const key = parseCacheKey(row);
    const cached = parseCache.get(key);
    if (cached) return cached;

    const metadata = JSON.parse(row.metadata || '{}');
    const stats = row.stats ? JSON.parse(row.stats) : undefined;

    const result: ReportHistory = {
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

    if (parseCache.size >= PARSE_CACHE_MAX) {
      const firstKey = parseCache.keys().next().value;
      if (firstKey !== undefined) parseCache.delete(firstKey);
    }
    parseCache.set(key, result);
    return result;
  }
}

export const reportDb = ReportDatabase.getInstance();
