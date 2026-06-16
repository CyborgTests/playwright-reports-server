import { RESERVED_REPORT_FIELDS, type ReportStats } from '@playwright-reports/shared';
import { type ExpressionBuilder, type SelectQueryBuilder, sql } from 'kysely';
import { defaultProjectName } from '../../constants.js';
import type { ReadReportsInput, ReadReportsOutput, ReportHistory } from '../../storage/types.js';
import { withError } from '../../withError.js';
import { testManagementService } from '../test-management/index.js';
import { getDatabase } from './db.js';
import { type Database, getKysely, type ReportsRow } from './kysely.js';
import { projectSummaryDb } from './projectSummary.sqlite.js';
import { singletonOf } from './singleton.js';
import { testDb } from './tests.sqlite.js';
import { chunk, parseJsonColumn } from './utils.js';

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

type ReportRow = ReportsRow;

type ReportSummaryRow = Pick<
  ReportRow,
  'reportID' | 'project' | 'title' | 'displayNumber' | 'createdAt' | 'reportUrl'
>;

// every `reports` column except `files` - the full test-file tree.
// list/analytics paths that never read `.files` use this to avoid
// transferring and JSON.parsing it per row.
const REPORT_COLUMNS_WITHOUT_FILES = [
  'reportID',
  'project',
  'title',
  'displayNumber',
  'createdAt',
  'reportUrl',
  'size',
  'sizeBytes',
  'stats',
  'metadata',
  'passRate',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof ReportsRow>;

// Cache parsed metadata/stats keyed by (reportID, updatedAt) so list endpoints
// don't re-run JSON.parse on every row of every request.
const PARSE_CACHE_MAX = 5000;
const parseCache = new Map<string, ReportHistory>();
function parseCacheKey(row: Pick<ReportRow, 'reportID' | 'updatedAt'>): string {
  return `${row.reportID}|${row.updatedAt ?? ''}`;
}

export class ReportDatabase {
  public initialized = false;
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public getExpiredIds(cutoffISO: string, limit: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT reportID FROM reports
         WHERE createdAt < ?
           AND reportID NOT IN (
             SELECT regressedAtReportId FROM regressions
             WHERE recoveredAtReportId IS NULL
           )
         ORDER BY createdAt ASC
         LIMIT ?`
      )
      .all(cutoffISO, limit) as Array<{ reportID: string }>;
    return rows.map((row) => row.reportID);
  }

  public async init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log(`[report db] initialized (${this.getCount()} reports)`);
  }

  public async populateTestRuns(): Promise<void> {
    if (!this.initialized) {
      console.warn('[report db] Reports database not initialized, skipping processing');
      return;
    }

    try {
      const unprocessedCompiled = this.k
        .selectFrom('reports')
        .select('reportID')
        .where('reportID', 'not in', this.k.selectFrom('test_runs').select('reportId').distinct())
        .orderBy('createdAt', 'asc')
        .compile();
      const unprocessedRows = this.db
        .prepare(unprocessedCompiled.sql)
        .all(...unprocessedCompiled.parameters) as Array<{ reportID: string }>;

      if (!unprocessedRows.length) {
        console.log('[report db] All reports have already been parsed');
        return;
      }

      console.log(`[report db] Processing ${unprocessedRows.length} unprocessed reports`);

      let processedCount = 0;
      let errorCount = 0;

      for (const { reportID } of unprocessedRows) {
        const report = this.getByID(reportID);
        if (!report) continue;
        const { error } = await withError(testManagementService.processReport(report));

        if (error) {
          console.error(`[report db] Error processing report ${reportID}:`, error);
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
      files,
      ...metadata
    } = report;

    let createdAtStr: string;
    if (createdAt instanceof Date) {
      createdAtStr = createdAt.toISOString();
    } else if (typeof createdAt === 'string') {
      createdAtStr = createdAt;
    } else {
      createdAtStr = new Date(createdAt as number).toISOString();
    }

    const reportDuration = (metadata as { duration?: unknown }).duration;
    const durationMs = typeof reportDuration === 'number' ? reportDuration : null;

    // kysely doesn't model INSERT OR REPLACE well; use ON CONFLICT REPLACE shape.
    const compiled = this.k
      .insertInto('reports')
      .values({
        reportID,
        project: project || '',
        title: title || null,
        displayNumber: displayNumber || null,
        createdAt: createdAtStr,
        reportUrl,
        size: size || null,
        sizeBytes: sizeBytes || 0,
        stats: stats ? JSON.stringify(stats) : null,
        metadata: JSON.stringify(metadata),
        files: files ? JSON.stringify(files) : null,
        passRate: computePassRateFromStats(stats),
        statTotal: stats?.total ?? null,
        statExpected: stats?.expected ?? null,
        statUnexpected: stats?.unexpected ?? null,
        statFlaky: stats?.flaky ?? null,
        durationMs,
        updatedAt: undefined,
      })
      .onConflict((oc) =>
        oc.column('reportID').doUpdateSet((eb) => ({
          project: eb.ref('excluded.project'),
          title: eb.ref('excluded.title'),
          displayNumber: eb.ref('excluded.displayNumber'),
          createdAt: eb.ref('excluded.createdAt'),
          reportUrl: eb.ref('excluded.reportUrl'),
          size: eb.ref('excluded.size'),
          sizeBytes: eb.ref('excluded.sizeBytes'),
          stats: eb.ref('excluded.stats'),
          metadata: eb.ref('excluded.metadata'),
          files: eb.ref('excluded.files'),
          passRate: eb.ref('excluded.passRate'),
          statTotal: eb.ref('excluded.statTotal'),
          statExpected: eb.ref('excluded.statExpected'),
          statUnexpected: eb.ref('excluded.statUnexpected'),
          statFlaky: eb.ref('excluded.statFlaky'),
          durationMs: eb.ref('excluded.durationMs'),
          updatedAt: new Date().toISOString(),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
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
    for (const idChunk of chunk(reportIds, 500)) {
      const compiled = this.k
        .selectFrom('reports')
        .selectAll()
        .where('reportID', 'in', idChunk)
        .compile();
      const found = this.db.prepare(compiled.sql).all(...compiled.parameters) as ReportRow[];
      for (const row of found) rows.set(row.reportID, row);
    }
    const missing = reportIds.filter((id) => !rows.has(id));
    if (missing.length > 0) {
      return { updated: 0, missing };
    }

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
        const compiled = this.k
          .updateTable('reports')
          .set({
            project: nextProject,
            metadata: JSON.stringify(metadata),
            updatedAt: new Date().toISOString(),
          })
          .where('reportID', '=', id)
          .compile();
        this.db.prepare(compiled.sql).run(...compiled.parameters);

        if (setProject && nextProject !== row.project) {
          const oldProject = row.project;
          const movedAt = new Date().toISOString();
          this.db
            .prepare(
              `INSERT OR IGNORE INTO tests (
                 testId, fileId, project, filePath, title, createdAt,
                 latestRunAt, latestOutcome, latestNonSkippedAt,
                 flakinessScore, quarantined, quarantineReason,
                 totalRuns, recentPassRate, avgDuration,
                 latestFailureCategory, flakinessResetAt
               )
               SELECT DISTINCT
                 t.testId, t.fileId, ?, t.filePath, t.title,
                 ?,
                 NULL, NULL, NULL, NULL, 0, NULL, 0, NULL, NULL, NULL, NULL
               FROM tests t
               WHERE t.project = ?
                 AND (t.testId, t.fileId) IN (
                   SELECT DISTINCT testId, fileId FROM test_runs WHERE reportId = ?
                 )`
            )
            .run(nextProject, movedAt, oldProject, id);

          const affectedLanes = this.db
            .prepare('SELECT DISTINCT testId, fileId FROM test_runs WHERE reportId = ?')
            .all(id) as Array<{ testId: string; fileId: string }>;

          this.db
            .prepare('UPDATE test_runs SET project = ? WHERE reportId = ?')
            .run(nextProject, id);
          this.db
            .prepare('UPDATE test_llm_analyses SET project = ? WHERE reportId = ?')
            .run(nextProject, id);
          this.db
            .prepare(
              `UPDATE OR IGNORE analysis_feedback SET project = ?
               WHERE reportId = ? AND project = ?`
            )
            .run(nextProject, id, oldProject);
          this.db
            .prepare(
              `UPDATE regressions SET project = ?
               WHERE regressedAtReportId = ? OR recoveredAtReportId = ?`
            )
            .run(nextProject, id, id);

          for (const lane of affectedLanes) {
            testDb.refreshTestStatCols(lane.testId, lane.fileId, nextProject);
            const stillUsed = this.db
              .prepare(
                'SELECT 1 FROM test_runs WHERE testId = ? AND fileId = ? AND project = ? LIMIT 1'
              )
              .get(lane.testId, lane.fileId, oldProject);
            if (stillUsed) {
              testDb.refreshTestStatCols(lane.testId, lane.fileId, oldProject);
            } else {
              this.db
                .prepare('DELETE FROM tests WHERE testId = ? AND fileId = ? AND project = ?')
                .run(lane.testId, lane.fileId, oldProject);
            }
          }
        }
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
    const deleteBatch = this.db.transaction((ids: string[]) => {
      // capture the projects these reports belong to before deleting, so we can
      // drop the summaries of any project whose last report is removed.
      const projCompiled = this.k
        .selectFrom('reports')
        .select('project')
        .distinct()
        .where('reportID', 'in', ids)
        .compile();
      const affectedProjects = (
        this.db.prepare(projCompiled.sql).all(...projCompiled.parameters) as Array<{
          project: string;
        }>
      ).map((r) => r.project);

      // capture the tests these reports' runs touched before deleting — the
      // report delete cascades the runs away, after which we can't find them.
      const testsCompiled = this.k
        .selectFrom('test_runs')
        .select(['testId', 'fileId', 'project'])
        .distinct()
        .where('reportId', 'in', ids)
        .compile();
      const affectedTests = this.db
        .prepare(testsCompiled.sql)
        .all(...testsCompiled.parameters) as Array<{
        testId: string;
        fileId: string;
        project: string;
      }>;

      const compiled = this.k.deleteFrom('reports').where('reportID', 'in', ids).compile();
      this.db.prepare(compiled.sql).run(...compiled.parameters);
      for (const id of ids) {
        for (const key of parseCache.keys()) {
          if (key.startsWith(`${id}|`)) parseCache.delete(key);
        }
      }

      // no FK can cascade reports -> project_llm_summaries
      // when a project loses its last report, drop its summary.
      for (const project of affectedProjects) {
        const remainingCompiled = this.k
          .selectFrom('reports')
          .select('reportID')
          .where('project', '=', project)
          .limit(1)
          .compile();
        const remaining = this.db
          .prepare(remainingCompiled.sql)
          .get(...remainingCompiled.parameters);
        if (!remaining) projectSummaryDb.deleteByProject(project);
      }

      // orphan-test cleanup: the report delete cascaded its test_runs away;
      // a test left with zero runs is removed
      // its' runs/analyses/feedback/regressions cascade via the tests FK
      for (const part of chunk(affectedTests, 300)) {
        const tuples = part.map(() => '(?, ?, ?)').join(', ');
        const params = part.flatMap((t) => [t.testId, t.fileId, t.project]);
        this.db
          .prepare(
            `DELETE FROM tests
             WHERE (testId, fileId, project) IN (VALUES ${tuples})
               AND NOT EXISTS (
                 SELECT 1 FROM test_runs tr
                 WHERE tr.testId = tests.testId
                   AND tr.fileId = tests.fileId
                   AND tr.project = tests.project
               )`
          )
          .run(...params);
      }
    });

    for (const batch of chunk(reportIds, CHUNK_SIZE)) {
      deleteBatch(batch);
    }
  }

  public onCreated(report: ReportHistory) {
    const reportWithDisplayNumber = {
      ...report,
      displayNumber: report.displayNumber ?? this.getNextDisplayNumber(),
    };
    this.insertReport(reportWithDisplayNumber);
  }

  public getDistinctProjects(): string[] {
    const compiled = this.k
      .selectFrom('reports')
      .select('project')
      .distinct()
      .where('project', '!=', '')
      .orderBy('project', 'asc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      project: string;
    }>;
    return rows.map((r) => r.project);
  }

  public getDistinctTags(project?: string): string[] {
    let q = this.k.selectFrom('reports').select('metadata');
    if (project) {
      q = q.where('project', '=', project);
    }
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      metadata: string;
    }>;

    const allTags = new Set<string>();
    for (const row of rows) {
      const parsed = parseJsonColumn<Record<string, unknown>>(row.metadata, {});
      for (const [key, value] of Object.entries(parsed)) {
        if (RESERVED_REPORT_FIELDS.has(key)) continue;
        if (value === undefined || value === null) continue;
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
          continue;
        allTags.add(`${key}: ${value}`);
      }
    }
    return Array.from(allTags).sort();
  }

  public getNewestReportBefore(project: string, beforeISO: string): ReportHistory | undefined {
    const compiled = this.k
      .selectFrom('reports')
      .selectAll()
      .where('project', '=', project)
      .where('createdAt', '<', beforeISO)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as ReportRow | undefined;
    return row ? this.rowToReport(row) : undefined;
  }

  public getPreviousReportId(reportID: string): string | null {
    // self-join to find the prior report in the same project
    const compiled = this.k
      .selectFrom('reports as cur')
      .innerJoin('reports as prev', 'prev.project', 'cur.project')
      .select('prev.reportID')
      .where('cur.reportID', '=', reportID)
      .whereRef('prev.createdAt', '<', 'cur.createdAt')
      .orderBy('prev.createdAt', 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { reportID: string }
      | undefined;
    return row?.reportID ?? null;
  }

  public getByID(reportID: string): ReportHistory | undefined {
    const compiled = this.k
      .selectFrom('reports')
      .selectAll()
      .where('reportID', '=', reportID)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as ReportRow | undefined;
    return row ? this.rowToReport(row) : undefined;
  }

  public getByProject(
    project?: string,
    opts?: { from?: string; to?: string; failedOnly?: boolean }
  ): ReportHistory[] {
    const hasProject = project && project !== defaultProjectName;
    let q = this.k
      .selectFrom('reports')
      .select(REPORT_COLUMNS_WITHOUT_FILES)
      .orderBy('createdAt', 'desc');
    if (hasProject) q = q.where('project', '=', project ?? '');
    if (opts?.from) q = q.where('createdAt', '>=', opts.from);
    if (opts?.to) q = q.where('createdAt', '<', opts.to);
    if (opts?.failedOnly) {
      q = q.where(sql<boolean>`(COALESCE(statUnexpected, 0) > 0 OR COALESCE(statFlaky, 0) > 0)`);
    }
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as ReportRow[];
    return rows.map((row) => this.rowToReport(row));
  }

  public getLatestByProject(project?: string, limit = 10): ReportHistory[] {
    let q = this.k.selectFrom('reports').selectAll().orderBy('createdAt', 'desc').limit(limit);
    if (project && project !== 'all') q = q.where('project', '=', project);
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as ReportRow[];
    return rows.map((row) => this.rowToReport(row));
  }

  public getLatestByProjectBefore(
    project: string | undefined,
    beforeCreatedAt: string,
    limit: number
  ): ReportHistory[] {
    let q = this.k
      .selectFrom('reports')
      .selectAll()
      .where('createdAt', '<', beforeCreatedAt)
      .orderBy('createdAt', 'desc')
      .limit(limit);
    if (project && project !== 'all') q = q.where('project', '=', project);
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as ReportRow[];
    return rows.map((row) => this.rowToReport(row));
  }

  public getLatestByProjects(projects: string[], limit: number): Map<string, ReportHistoryLite[]> {
    const out = new Map<string, ReportHistoryLite[]>();
    if (projects.length === 0 || limit <= 0) return out;

    // ROW_NUMBER() OVER PARTITION BY in a subquery — Kysely can express this
    // via .with()/window functions, but the typed builder gets verbose. Raw sql``
    // here keeps the query readable while still going through Kysely.
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
    const compiled = this.k
      .selectFrom('reports')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as { count: number };
    return row.count;
  }

  // SQL-side aggregator for analytics. SUM-of-json-extract for the stats columns
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
    const applyWhere = <O>(
      qb: SelectQueryBuilder<Database, 'reports', O>
    ): SelectQueryBuilder<Database, 'reports', O> => {
      let q = qb;
      if (project && project !== defaultProjectName) q = q.where('project', '=', project);
      if (from) q = q.where('createdAt', '>=', from);
      if (to) q = q.where('createdAt', '<', to);
      if (options.failedOnly) {
        q = q.where(sql<boolean>`(COALESCE(statUnexpected, 0) > 0 OR COALESCE(statFlaky, 0) > 0)`);
      }
      return q;
    };

    const compiled = applyWhere(
      this.k
        .selectFrom('reports')
        .select((eb) => [
          eb.fn.countAll<number>().as('count'),
          sql<number>`COALESCE(SUM(statTotal), 0)`.as('totalTests'),
          sql<number>`COALESCE(SUM(statExpected), 0)`.as('totalPassed'),
          sql<number>`COALESCE(SUM(statUnexpected), 0)`.as('totalFailed'),
          sql<number>`COALESCE(SUM(statFlaky), 0)`.as('totalFlaky'),
          sql<number>`COALESCE(SUM(durationMs), 0)`.as('sumDuration'),
        ])
    ).compile();

    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as {
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
    const compiled = this.k.deleteFrom('reports').compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public query(input?: ReadReportsInput): ReadReportsOutput {
    const applyWhere = <O>(
      qb: SelectQueryBuilder<Database, 'reports', O>
    ): SelectQueryBuilder<Database, 'reports', O> => {
      let q = qb;
      if (input?.ids && input.ids.length > 0) q = q.where('reportID', 'in', input.ids);
      if (input?.project && input.project !== defaultProjectName) {
        q = q.where('project', '=', input.project);
      }
      const search = input?.search?.trim();
      if (search) {
        const pattern = `%${search.toLowerCase()}%`;
        const numericSearch = search.replace(/^#/, '');
        const displayNumberMatch = /^\d+$/.test(numericSearch)
          ? Number.parseInt(numericSearch, 10)
          : null;
        q = q.where((eb) =>
          eb.or([
            eb(eb.fn('LOWER', ['title']), 'like', pattern),
            eb(eb.fn('LOWER', ['reportID']), 'like', pattern),
            eb(eb.fn('LOWER', ['project']), 'like', pattern),
            eb(eb.fn('LOWER', ['metadata']), 'like', pattern),
            ...(displayNumberMatch !== null ? [eb('displayNumber', '=', displayNumberMatch)] : []),
          ])
        );
      }
      if (input?.from) q = q.where('createdAt', '>=', input.from);
      if (input?.to) q = q.where('createdAt', '<', input.to);
      if (input?.tags?.length) {
        for (const tag of input.tags) {
          const colonIndex = tag.indexOf(':');
          if (colonIndex === -1) {
            q = q.where((eb: ExpressionBuilder<Database, 'reports'>) =>
              eb(eb.fn('LOWER', ['metadata']), 'like', `%${tag.toLowerCase()}%`)
            );
          } else {
            const key = tag.slice(0, colonIndex).trim();
            const value = tag.slice(colonIndex + 1).trim();
            q = q.where((eb: ExpressionBuilder<Database, 'reports'>) =>
              eb(
                eb.fn('LOWER', ['metadata']),
                'like',
                `%"${key.toLowerCase()}":"${value.toLowerCase()}"%`
              )
            );
          }
        }
      }
      if (input?.passRate === 'passing') {
        q = q.where('passRate', '>=', 100);
      } else if (input?.passRate === 'failing') {
        q = q.where('passRate', '<', 100).where('passRate', 'is not', null);
      } else if (input?.passRate === 'below-threshold') {
        q = q.where('passRate', '<', 70).where('passRate', 'is not', null);
      }
      if (input?.regressionsOnly) {
        q = q.where((eb: ExpressionBuilder<Database, 'reports'>) =>
          eb.exists(
            eb
              .selectFrom('regressions')
              .select((sub) => sub.lit(1).as('x'))
              .whereRef('regressions.regressedAtReportId', '=', 'reports.reportID')
          )
        );
      }
      return q;
    };

    const runCount = (): number => {
      const countCompiled = applyWhere(
        this.k.selectFrom('reports').select((eb) => eb.fn.countAll<number>().as('count'))
      ).compile();
      return (
        this.db.prepare(countCompiled.sql).get(...countCompiled.parameters) as { count: number }
      ).count;
    };

    const hasScanFilter = !!input?.search?.trim() || (input?.tags?.length ?? 0) > 0;

    // skip the `files` column, only the detail by id query needs it.
    let listSelect = applyWhere(
      this.k
        .selectFrom('reports')
        .select([
          'reportID',
          'project',
          'title',
          'displayNumber',
          'createdAt',
          'reportUrl',
          'size',
          'sizeBytes',
          'stats',
          'metadata',
          'passRate',
          'updatedAt',
        ])
    );
    if (hasScanFilter) {
      listSelect = listSelect.select(sql<number>`COUNT(*) OVER()`.as('__total'));
    }
    let listQuery = listSelect.orderBy('createdAt', 'desc');
    if (input?.pagination?.limit !== undefined) {
      listQuery = listQuery
        .limit(Math.max(0, Math.floor(input.pagination.limit)))
        .offset(Math.max(0, Math.floor(input.pagination.offset ?? 0)));
    }
    const listCompiled = listQuery.compile();
    const rawRows = this.db.prepare(listCompiled.sql).all(...listCompiled.parameters) as Array<
      ReportRow & { __total?: number }
    >;

    let total: number;
    if (hasScanFilter) {
      if (rawRows.length > 0) {
        total = rawRows[0].__total ?? 0;
      } else {
        total = (input?.pagination?.offset ?? 0) > 0 ? runCount() : 0;
      }
    } else {
      total = runCount();
    }

    const rows = rawRows.map(({ __total, ...row }) => row as ReportRow);
    return { reports: rows.map((row) => this.rowToReport(row)), total };
  }

  public getNextDisplayNumber(): number {
    const compiled = this.k
      .selectFrom('reports')
      .select((eb) => eb.fn.max<number | null>('displayNumber').as('maxNumber'))
      .compile();
    const result = this.db.prepare(compiled.sql).get(...compiled.parameters) as {
      maxNumber: number | null;
    };
    return (result.maxNumber || 0) + 1;
  }

  private rowToReport(row: ReportRow): ReportHistory {
    const key = parseCacheKey(row);
    const cached = parseCache.get(key);
    let baseDecoded: ReportHistory;
    if (cached) {
      baseDecoded = cached;
    } else {
      const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata, {});
      const stats = parseJsonColumn<ReportStats | undefined>(row.stats, undefined);
      baseDecoded = {
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
      } as unknown as ReportHistory;
      if (parseCache.size >= PARSE_CACHE_MAX) {
        const firstKey = parseCache.keys().next().value;
        if (firstKey !== undefined) parseCache.delete(firstKey);
      }
      parseCache.set(key, baseDecoded);
    }

    if (row.files != null) {
      return { ...baseDecoded, files: parseJsonColumn<ReportHistory['files']>(row.files, []) };
    }
    return baseDecoded;
  }

  private rowToReportLite(
    row: Omit<
      ReportRow,
      | 'metadata'
      | 'updatedAt'
      | 'passRate'
      | 'files'
      | 'statTotal'
      | 'statExpected'
      | 'statUnexpected'
      | 'statFlaky'
      | 'durationMs'
    >
  ): ReportHistoryLite {
    return {
      reportID: row.reportID,
      project: row.project,
      title: row.title ?? undefined,
      displayNumber: row.displayNumber ?? undefined,
      createdAt: row.createdAt,
      reportUrl: row.reportUrl,
      size: row.size ?? undefined,
      sizeBytes: row.sizeBytes,
      stats: parseJsonColumn<ReportStats | undefined>(row.stats, undefined),
    };
  }

  public findByDisplayNumber(displayNumber: number, project?: string): Array<ReportSummaryRow> {
    let q = this.k
      .selectFrom('reports')
      .select(['reportID', 'project', 'title', 'displayNumber', 'createdAt', 'reportUrl'])
      .where('displayNumber', '=', displayNumber)
      .orderBy('createdAt', 'desc');
    if (project) q = q.where('project', '=', project);
    const compiled = q.compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as ReportSummaryRow[];
  }

  public findPreviousInProject(
    project: string,
    excludeReportId: string,
    createdAtISO: string
  ): { reportID: string } | null {
    const compiled = this.k
      .selectFrom('reports')
      .select('reportID')
      .where('project', '=', project)
      .where('reportID', '!=', excludeReportId)
      .where('createdAt', '<', createdAtISO)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { reportID: string }
      | undefined;
    return row ?? null;
  }
}

export const reportDb = singletonOf('reports', () => new ReportDatabase());
