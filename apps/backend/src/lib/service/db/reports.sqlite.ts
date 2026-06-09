import type { ReportStats } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { defaultProjectName } from '../../constants.js';
import type { ReadReportsInput, ReadReportsOutput, ReportHistory } from '../../storage/types.js';
import { withError } from '../../withError.js';
import { testManagementService } from '../testManagement.js';
import { getDatabase } from './db.js';
import { failureSummaryDb } from './failureSummary.sqlite.js';
import { llmTasksDb } from './llmTasks.sqlite.js';
import { singletonOf } from './singleton.js';
import { testAnalysisDb } from './testAnalysis.sqlite.js';
import { testDb } from './tests.sqlite.js';
import {
  buildWhere,
  chunk,
  paginationClause,
  parseJsonColumn,
  type WhereFragment,
} from './utils.js';

function computePassRateFromStats(stats: ReportStats | undefined): number | null {
  if (!stats) return null;
  const passed = stats.expected ?? 0;
  const failed = stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const denom = passed + failed + flaky;
  if (denom === 0) return null;
  return (passed / denom) * 100;
}

/** Subset of `ReportHistory` for hot read paths that need stats but never
 *  inspect metadata. */
export interface ReportHistoryLite {
  reportID: string;
  project: string;
  title?: string;
  displayNumber?: number;
  createdAt: string;
  reportUrl: string;
  size?: string;
  sizeBytes: number;
  stats?: ReportStats;
}

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
      number | null,
    ]
  >;
  private readonly getByIDStmt: Database.Statement<[string]>;
  private readonly getAllStmt: Database.Statement<[]>;
  private readonly getByProjectStmt: Database.Statement<[string]>;
  private readonly searchStmt: Database.Statement<[string, string, string, string]>;
  private readonly getExpiredIdsStmt: Database.Statement<[string, number]>;

  constructor() {
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO reports (reportID, project, title, displayNumber, createdAt, reportUrl, size, sizeBytes, stats, metadata, passRate, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      JSON.stringify(metadata),
      computePassRateFromStats(stats)
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
        const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata, {});

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

    for (const batch of chunk(reportIds, CHUNK_SIZE)) {
      cascadeDelete(batch);
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

    const { sql: whereSql, params } = buildWhere([
      hasProject ? { sql: 'project = ?', params: [project ?? ''] } : null,
      hasFrom ? { sql: 'createdAt >= ?', params: [opts?.from ?? ''] } : null,
      hasTo ? { sql: 'createdAt < ?', params: [opts?.to ?? ''] } : null,
    ]);

    const sql = `SELECT * FROM reports ${whereSql} ORDER BY createdAt DESC`;
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

  public getLatestByProjects(projects: string[], limit: number): Map<string, ReportHistoryLite[]> {
    const out = new Map<string, ReportHistoryLite[]>();
    if (projects.length === 0 || limit <= 0) return out;

    const placeholders = projects.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT reportID, project, title, displayNumber, createdAt, reportUrl,
                size, sizeBytes, stats
         FROM (
           SELECT *,
                  ROW_NUMBER() OVER (PARTITION BY project ORDER BY createdAt DESC) AS rn
           FROM reports
           WHERE project IN (${placeholders})
         )
         WHERE rn <= ?`
      )
      .all(...projects, limit) as Array<{
      reportID: string;
      project: string;
      title: string | null;
      displayNumber: number | null;
      createdAt: string;
      reportUrl: string;
      size: string | null;
      sizeBytes: number;
      stats: string | null;
    }>;

    for (const project of projects) out.set(project, []);
    for (const row of rows) {
      const bucket = out.get(row.project);
      if (bucket) bucket.push(this.rowToReportLite(row));
    }
    return out;
  }

  public getCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM reports').get() as {
      count: number;
    };

    return result.count;
  }

  /** SQL-side aggregator for analytics windows. Returns only the numbers we
   *  need for trend computation and avoids hydrating every report row,
   *  JSON-parsing its metadata. */
  public aggregateForAnalytics(
    project?: string,
    from?: string,
    to?: string,
    options: { failedOnly?: boolean } = {}
  ): {
    count: number;
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    totalFlaky: number;
    totalExecuted: number;
    sumDuration: number;
  } {
    const { sql: whereSql, params } = buildWhere([
      project && project !== defaultProjectName ? { sql: 'project = ?', params: [project] } : null,
      from ? { sql: 'createdAt >= ?', params: [from] } : null,
      to ? { sql: 'createdAt < ?', params: [to] } : null,
      options.failedOnly
        ? {
            sql: "(CAST(json_extract(stats, '$.unexpected') AS REAL) > 0 OR CAST(json_extract(stats, '$.flaky') AS REAL) > 0)",
            params: [],
          }
        : null,
    ]);

    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS count,
           COALESCE(SUM(CAST(json_extract(stats, '$.total') AS REAL)), 0) AS totalTests,
           COALESCE(SUM(CAST(json_extract(stats, '$.expected') AS REAL)), 0) AS totalPassed,
           COALESCE(SUM(CAST(json_extract(stats, '$.unexpected') AS REAL)), 0) AS totalFailed,
           COALESCE(SUM(CAST(json_extract(stats, '$.flaky') AS REAL)), 0) AS totalFlaky,
           COALESCE(SUM(CAST(json_extract(metadata, '$.duration') AS REAL)), 0) AS sumDuration
         FROM reports ${whereSql}`.trim()
      )
      .get(...params) as {
      count: number;
      totalTests: number;
      totalPassed: number;
      totalFailed: number;
      totalFlaky: number;
      sumDuration: number;
    };
    return {
      ...row,
      totalExecuted: row.totalPassed + row.totalFailed + row.totalFlaky,
    };
  }

  public clear(): void {
    this.db.prepare('DELETE FROM reports').run();
  }

  public backfillPassRate(): number {
    const rows = this.db
      .prepare<[], { reportID: string; stats: string | null }>(
        'SELECT reportID, stats FROM reports WHERE passRate IS NULL'
      )
      .all();
    if (rows.length === 0) return 0;

    const update = this.db.prepare<[number | null, string]>(
      'UPDATE reports SET passRate = ? WHERE reportID = ?'
    );

    const apply = this.db.transaction((batch: typeof rows) => {
      for (const row of batch) {
        const stats = parseJsonColumn<ReportStats | undefined>(row.stats, undefined);
        update.run(computePassRateFromStats(stats), row.reportID);
      }
    });
    apply(rows);

    return rows.length;
  }

  public query(input?: ReadReportsInput): ReadReportsOutput {
    const tagFragments =
      input?.tags?.map((tag): WhereFragment => {
        const colonIndex = tag.indexOf(':');
        if (colonIndex === -1) {
          return { sql: 'LOWER(metadata) LIKE ?', params: [`%${tag.toLowerCase()}%`] };
        }
        const key = tag.slice(0, colonIndex).trim();
        const value = tag.slice(colonIndex + 1).trim();
        return {
          sql: 'LOWER(metadata) LIKE ?',
          params: [`%"${key.toLowerCase()}":"${value.toLowerCase()}"%`],
        };
      }) ?? [];

    const search = input?.search?.trim();
    const searchTerm = search ? `%${search.toLowerCase()}%` : null;

    const { sql: whereSql, params: whereParams } = buildWhere([
      input?.ids && input.ids.length > 0
        ? {
            sql: `reportID IN (${input.ids.map(() => '?').join(', ')})`,
            params: input.ids,
          }
        : null,
      input?.project && input.project !== defaultProjectName
        ? { sql: 'project = ?', params: [input.project] }
        : null,
      searchTerm
        ? {
            sql: '(LOWER(title) LIKE ? OR LOWER(reportID) LIKE ? OR LOWER(project) LIKE ? OR LOWER(metadata) LIKE ?)',
            params: [searchTerm, searchTerm, searchTerm, searchTerm],
          }
        : null,
      input?.from ? { sql: 'createdAt >= ?', params: [input.from] } : null,
      input?.to ? { sql: 'createdAt < ?', params: [input.to] } : null,
      ...tagFragments,
      input?.passRate === 'passing'
        ? { sql: 'passRate >= 100', params: [] }
        : input?.passRate === 'failing'
          ? { sql: 'passRate < 100 AND passRate IS NOT NULL', params: [] }
          : input?.passRate === 'below-threshold'
            ? { sql: 'passRate < 70 AND passRate IS NOT NULL', params: [] }
            : null,
    ]);

    const baseQuery = `SELECT * FROM reports ${whereSql} ORDER BY createdAt DESC`.trim();
    const countQuery = `SELECT COUNT(*) as count FROM reports ${whereSql}`.trim();

    const countResult = this.db.prepare(countQuery).get(...whereParams) as { count: number };
    const total = countResult.count;

    const { sql: pageSql, params: pageParams } = paginationClause(input?.pagination);
    const query = pageSql ? `${baseQuery} ${pageSql}` : baseQuery;
    const params = [...whereParams, ...pageParams];

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

  private rowToReportLite(row: {
    reportID: string;
    project: string;
    title: string | null;
    displayNumber: number | null;
    createdAt: string;
    reportUrl: string;
    size: string | null;
    sizeBytes: number;
    stats: string | null;
  }): ReportHistoryLite {
    return {
      reportID: row.reportID,
      project: row.project,
      title: row.title ?? undefined,
      displayNumber: row.displayNumber ?? undefined,
      createdAt: row.createdAt,
      reportUrl: row.reportUrl,
      size: row.size ?? undefined,
      sizeBytes: row.sizeBytes,
      stats: row.stats ? (JSON.parse(row.stats) as ReportStats) : undefined,
    };
  }

  public findByDisplayNumber(
    displayNumber: number,
    project?: string
  ): Array<{
    reportID: string;
    project: string;
    title: string | null;
    displayNumber: number | null;
    createdAt: string;
    reportUrl: string;
  }> {
    const rows = project
      ? this.db
          .prepare(
            `SELECT reportID, project, title, displayNumber, createdAt, reportUrl
             FROM reports WHERE displayNumber = ? AND project = ?
             ORDER BY createdAt DESC`
          )
          .all(displayNumber, project)
      : this.db
          .prepare(
            `SELECT reportID, project, title, displayNumber, createdAt, reportUrl
             FROM reports WHERE displayNumber = ?
             ORDER BY createdAt DESC`
          )
          .all(displayNumber);
    return rows as Array<{
      reportID: string;
      project: string;
      title: string | null;
      displayNumber: number | null;
      createdAt: string;
      reportUrl: string;
    }>;
  }

  public findPreviousInProject(
    project: string,
    excludeReportId: string,
    createdAtISO: string
  ): { reportID: string } | null {
    const row = this.db
      .prepare(
        `SELECT reportID FROM reports
         WHERE project = ?
           AND reportID != ?
           AND createdAt < ?
         ORDER BY createdAt DESC
         LIMIT 1`
      )
      .get(project, excludeReportId, createdAtISO) as { reportID: string } | undefined;
    return row ?? null;
  }
}

export const reportDb = singletonOf('reports', () => new ReportDatabase());
