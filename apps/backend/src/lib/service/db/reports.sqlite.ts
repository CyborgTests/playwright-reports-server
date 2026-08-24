import {
  ATTACHMENT_CLEANUP_KINDS,
  type AttachmentCleanupKind,
  type ReportStats,
} from '@playwright-reports/shared';
import { type ExpressionBuilder, type SelectQueryBuilder, sql } from 'kysely';
import { defaultProjectName, serveReportRoute } from '../../constants.js';
import type {
  AttachmentSizes,
  ReadReportsInput,
  ReadReportsOutput,
  ReportHistory,
  ReportPath,
} from '../../storage/types.js';
import { dataEvents } from '../dataEvents.js';
import { dailyTotalsDb } from './dailyTotals.sqlite.js';
import { getDatabase } from './db.js';
import { type Database, getKysely, type ReportsRow } from './kysely.js';
import { projectSummaryDb } from './projectSummary.sqlite.js';
import { singletonOf } from './singleton.js';
import { distinctTags, replaceReportTags } from './tagsSync.js';
import { testDb } from './tests.sqlite.js';
import { chunk, parseJsonColumn } from './utils.js';

export interface ArtifactState {
  artifactsMissingAt: string | null;
  tracesDeletedAt: string | null;
  videosDeletedAt: string | null;
  screenshotsDeletedAt: string | null;
}

export interface ReportStorageRow {
  reportID: string;
  storagePath: string | null;
  sizeBytes: number;
  attachmentSizes: string | null;
  artifactsMissingAt: string | null;
}

export interface CleanupCursor {
  createdAt: string;
  reportID: string;
}

export interface CleanupCandidate extends CleanupCursor {
  storagePath: string | null;
}

const DELETED_COLUMN: Record<AttachmentCleanupKind, keyof ArtifactState> = {
  trace: 'tracesDeletedAt',
  video: 'videosDeletedAt',
  screenshot: 'screenshotsDeletedAt',
};

const EXPIRED_EXCEPT_OPEN_REGRESSIONS = `createdAt < ?
   AND reportID NOT IN (
     SELECT regressedAtReportId FROM regressions WHERE recoveredAtReportId IS NULL
   )`;

const AFTER_CURSOR = 'AND (createdAt, reportID) > (?, ?)';

const hasAttachmentsOfKind = (kind: AttachmentCleanupKind) =>
  `(attachmentSizes IS NULL OR COALESCE(json_extract(attachmentSizes, '$.${kind}.bytes'), 0) > 0)`;

const attachmentEstimateSql = (kind: AttachmentCleanupKind) => `
  SELECT
    COALESCE(SUM(CASE WHEN ${hasAttachmentsOfKind(kind)} THEN 1 ELSE 0 END), 0) AS affectedRows,
    COALESCE(SUM(json_extract(attachmentSizes, '$.${kind}.count')), 0) AS items,
    COALESCE(SUM(json_extract(attachmentSizes, '$.${kind}.bytes')), 0) AS bytes,
    COALESCE(SUM(CASE WHEN attachmentSizes IS NULL THEN 1 ELSE 0 END), 0) AS unmeasured
  FROM reports
  WHERE ${EXPIRED_EXCEPT_OPEN_REGRESSIONS} AND ${DELETED_COLUMN[kind]} IS NULL AND artifactsMissingAt IS NULL`;

const cursorParams = (after: CleanupCursor | null): [string, string] => [
  after?.createdAt ?? '',
  after?.reportID ?? '',
];

export const cursorOf = (rows: CleanupCursor[]): CleanupCursor | null =>
  rows.length > 0
    ? { createdAt: rows[rows.length - 1].createdAt, reportID: rows[rows.length - 1].reportID }
    : null;

export function removedAttachmentKinds(state: ArtifactState): AttachmentCleanupKind[] {
  return ATTACHMENT_CLEANUP_KINDS.filter((kind) => state[DELETED_COLUMN[kind]] !== null);
}

function statsFromColumns(
  row: Pick<
    ReportsRow,
    'statTotal' | 'statExpected' | 'statUnexpected' | 'statFlaky' | 'statSkipped'
  >
): ReportStats | undefined {
  if (row.statTotal == null) return undefined;
  return {
    total: row.statTotal,
    expected: row.statExpected ?? undefined,
    unexpected: row.statUnexpected ?? undefined,
    flaky: row.statFlaky ?? undefined,
    skipped: row.statSkipped ?? undefined,
  };
}

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
  reportUrl: string | null;
  size?: string;
  sizeBytes: number;
  stats?: ReportStats;
}

export interface ReportAnalyticsRow {
  reportID: string;
  createdAt: string;
  title?: string;
  displayNumber?: number;
  duration: number;
  stats: { total: number; expected: number; unexpected: number; flaky: number };
}

type ReportRow = ReportsRow;

type ReportSummaryRow = Pick<
  ReportRow,
  | 'reportID'
  | 'project'
  | 'title'
  | 'displayNumber'
  | 'createdAt'
  | 'reportUrl'
  | 'artifactsMissingAt'
>;

type ReportSummary = Omit<ReportSummaryRow, 'reportUrl'> & { reportUrl: string | null };

function servedReportUrl(row: Pick<ReportRow, 'reportUrl' | 'artifactsMissingAt'>): string | null {
  return row.artifactsMissingAt ? null : row.reportUrl;
}

const REPORT_LIST_COLUMNS = [
  'reportID',
  'project',
  'title',
  'displayNumber',
  'createdAt',
  'reportUrl',
  'size',
  'sizeBytes',
  'metadata',
  'passRate',
  'updatedAt',
  'statTotal',
  'statExpected',
  'statUnexpected',
  'statFlaky',
  'statSkipped',
  'storagePath',
  'artifactsMissingAt',
] as const satisfies ReadonlyArray<keyof ReportsRow>;

const REPORT_ANALYTICS_COLUMNS = [
  'reportID',
  'createdAt',
  'title',
  'displayNumber',
  'durationMs',
  'statTotal',
  'statExpected',
  'statUnexpected',
  'statFlaky',
] as const satisfies ReadonlyArray<keyof ReportsRow>;

// LRU cache of parsed metadata/stats keyed by (reportID, updatedAt) so list endpoints
// don't re-run JSON.parse on every row of every request.
const PARSE_CACHE_MAX = 1000;
const parseCache = new Map<string, ReportHistory>();
function parseCacheKey(row: Pick<ReportRow, 'reportID' | 'updatedAt'>): string {
  return `${row.reportID}|${row.updatedAt ?? ''}`;
}

const FAILED_ONLY_SQL = sql<boolean>`(COALESCE(statUnexpected, 0) > 0 OR COALESCE(statFlaky, 0) > 0)`;

function applyReportFilters<O>(
  q: SelectQueryBuilder<Database, 'reports', O>,
  project: string | undefined,
  opts?: { from?: string; to?: string; failedOnly?: boolean; before?: string; limit?: number }
): SelectQueryBuilder<Database, 'reports', O> {
  if (project && project !== defaultProjectName) q = q.where('project', '=', project);
  if (opts?.from) q = q.where('createdAt', '>=', opts.from);
  if (opts?.to) q = q.where('createdAt', '<', opts.to);
  if (opts?.before) q = q.where('createdAt', '<', opts.before);
  if (opts?.failedOnly) q = q.where(FAILED_ONLY_SQL);
  if (opts?.limit && opts.limit > 0) q = q.limit(opts.limit);
  return q;
}

export class ReportDatabase {
  public initialized = false;
  private readonly k = getKysely();
  private readonly db = getDatabase();

  private writeBatched<T>(sql: string, rows: T[], bind: (row: T, now: string) => unknown[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(sql);
    const now = new Date().toISOString();
    const tx = this.db.transaction((batch: T[]) => {
      for (const row of batch) stmt.run(...bind(row, now));
    });
    for (const batch of chunk(rows, 500)) tx(batch);
  }

  public getExpiredIds(cutoffISO: string, limit: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT reportID FROM reports
         WHERE ${EXPIRED_EXCEPT_OPEN_REGRESSIONS}
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
      storagePath,
      ...metadata
    } = report;

    const createdAtStr: string = createdAt;

    const reportDuration = (metadata as { duration?: unknown }).duration;
    const durationMs = typeof reportDuration === 'number' ? reportDuration : null;
    const git = report.metadata?.gitCommit as
      | { hash?: string; shortHash?: string; branch?: string; subject?: string }
      | undefined;
    const ci = report.metadata?.ci as { buildHref?: string } | undefined;

    // kysely doesn't model INSERT OR REPLACE well; use ON CONFLICT REPLACE shape.
    const compiled = this.k
      .insertInto('reports')
      .values({
        reportID,
        project: project || '',
        title: title || null,
        displayNumber: displayNumber || null,
        createdAt: createdAtStr,
        reportUrl: reportUrl ?? `${serveReportRoute}/${reportID}/index.html`,
        size: size || null,
        sizeBytes: sizeBytes || 0,
        metadata: JSON.stringify(metadata),
        passRate: computePassRateFromStats(stats),
        statTotal: stats?.total ?? null,
        statExpected: stats?.expected ?? null,
        statUnexpected: stats?.unexpected ?? null,
        statFlaky: stats?.flaky ?? null,
        statSkipped: stats?.skipped ?? null,
        durationMs,
        gitCommitHash: git?.hash ?? null,
        gitCommitShortHash: git?.shortHash ?? null,
        gitBranch: git?.branch ?? null,
        gitCommitSubject: git?.subject ?? null,
        ciBuildHref: ci?.buildHref ?? null,
        storagePath: storagePath ?? null,
        updatedAt: undefined,
      })
      .onConflict((oc) =>
        oc.column('reportID').doUpdateSet((eb) => ({
          artifactsMissingAt: null,
          attachmentSizes: null,
          tracesDeletedAt: null,
          videosDeletedAt: null,
          screenshotsDeletedAt: null,
          project: eb.ref('excluded.project'),
          title: eb.ref('excluded.title'),
          displayNumber: eb.ref('excluded.displayNumber'),
          createdAt: eb.ref('excluded.createdAt'),
          reportUrl: eb.ref('excluded.reportUrl'),
          size: eb.ref('excluded.size'),
          sizeBytes: eb.ref('excluded.sizeBytes'),
          metadata: eb.ref('excluded.metadata'),
          passRate: eb.ref('excluded.passRate'),
          statTotal: eb.ref('excluded.statTotal'),
          statExpected: eb.ref('excluded.statExpected'),
          statUnexpected: eb.ref('excluded.statUnexpected'),
          statFlaky: eb.ref('excluded.statFlaky'),
          statSkipped: eb.ref('excluded.statSkipped'),
          durationMs: eb.ref('excluded.durationMs'),
          gitCommitHash: eb.ref('excluded.gitCommitHash'),
          gitCommitShortHash: eb.ref('excluded.gitCommitShortHash'),
          gitBranch: eb.ref('excluded.gitBranch'),
          gitCommitSubject: eb.ref('excluded.gitCommitSubject'),
          ciBuildHref: eb.ref('excluded.ciBuildHref'),
          storagePath: eb.ref('excluded.storagePath'),
          updatedAt: new Date().toISOString(),
        }))
      )
      .compile();
    this.db.transaction(() => {
      this.db.prepare(compiled.sql).run(...compiled.parameters);
      replaceReportTags(this.db, reportID, metadata as Record<string, unknown>);
    })();
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
        replaceReportTags(this.db, id, metadata);

        if (setProject && nextProject !== row.project) {
          const oldProject = row.project;
          const movedAt = new Date().toISOString();
          dailyTotalsDb.moveReport(id, oldProject, nextProject);
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

      // capture the tests these reports' runs touched before deleting - the
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
        dailyTotalsDb.reverseReport(id);
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
    dataEvents.emitChanged('report');
  }

  public onCreated(report: ReportHistory) {
    const reportWithDisplayNumber = {
      ...report,
      displayNumber: report.displayNumber ?? this.getNextDisplayNumber(),
    };
    this.insertReport(reportWithDisplayNumber);
    dataEvents.emitChanged('report');
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
    return distinctTags(this.db, { entity: 'report', project });
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

  public getStoragePath(reportID: string): string | null {
    const row = this.db
      .prepare('SELECT storagePath FROM reports WHERE reportID = ?')
      .get(reportID) as { storagePath: string | null } | undefined;
    return row?.storagePath ?? null;
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
    opts?: { from?: string; to?: string; failedOnly?: boolean; before?: string; limit?: number }
  ): ReportHistory[] {
    const q = applyReportFilters(
      this.k.selectFrom('reports').select(REPORT_LIST_COLUMNS).orderBy('createdAt', 'desc'),
      project,
      opts
    );
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as ReportRow[];
    return rows.map((row) => this.rowToReport(row));
  }

  public getByProjectForAnalytics(
    project?: string,
    opts?: { from?: string; to?: string; failedOnly?: boolean; before?: string; limit?: number }
  ): ReportAnalyticsRow[] {
    const q = applyReportFilters(
      this.k.selectFrom('reports').select(REPORT_ANALYTICS_COLUMNS).orderBy('createdAt', 'desc'),
      project,
      opts
    );
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<
      Pick<
        ReportsRow,
        | 'reportID'
        | 'createdAt'
        | 'title'
        | 'displayNumber'
        | 'durationMs'
        | 'statTotal'
        | 'statExpected'
        | 'statUnexpected'
        | 'statFlaky'
      >
    >;
    return rows.map((r) => ({
      reportID: r.reportID,
      createdAt: r.createdAt,
      title: r.title ?? undefined,
      displayNumber: r.displayNumber ?? undefined,
      duration: r.durationMs ?? 0,
      stats: {
        total: r.statTotal ?? 0,
        expected: r.statExpected ?? 0,
        unexpected: r.statUnexpected ?? 0,
        flaky: r.statFlaky ?? 0,
      },
    }));
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

    // ROW_NUMBER() OVER PARTITION BY in a subquery - Kysely can express this
    // via .with()/window functions, but the typed builder gets verbose. Raw sql``
    // here keeps the query readable while still going through Kysely.
    const placeholders = projects.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT reportID, project, title, displayNumber, createdAt, reportUrl, artifactsMissingAt,
                size, sizeBytes, statTotal, statExpected, statUnexpected, statFlaky, statSkipped
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
      artifactsMissingAt: string | null;
      size: string | null;
      sizeBytes: number;
      statTotal: number | null;
      statExpected: number | null;
      statUnexpected: number | null;
      statFlaky: number | null;
      statSkipped: number | null;
    }>;

    for (const project of projects) out.set(project, []);
    for (const row of rows) {
      const bucket = out.get(row.project);
      if (bucket) bucket.push(this.rowToReportLite(row));
    }
    return out;
  }

  public getLabelsByIds(
    ids: string[]
  ): Map<string, { displayNumber: number | null; title: string | null }> {
    const out = new Map<string, { displayNumber: number | null; title: string | null }>();
    if (ids.length === 0) return out;
    for (const idChunk of chunk(ids, 500)) {
      const compiled = this.k
        .selectFrom('reports')
        .select(['reportID', 'displayNumber', 'title'])
        .where('reportID', 'in', idChunk)
        .compile();
      const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
        reportID: string;
        displayNumber: number | null;
        title: string | null;
      }>;
      for (const row of rows) {
        out.set(row.reportID, { displayNumber: row.displayNumber, title: row.title });
      }
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

  public getStorageInfo(): { count: number; totalSizeBytes: number } {
    return this.db
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(sizeBytes), 0) AS totalSizeBytes FROM reports WHERE sizeBytes > 0'
      )
      .get() as { count: number; totalSizeBytes: number };
  }

  public listReportStorageRows(limit: number): ReportStorageRow[] {
    return this.db
      .prepare(
        `SELECT reportID, storagePath, sizeBytes, attachmentSizes, artifactsMissingAt
         FROM reports
         WHERE sizeBytes > 0 OR attachmentSizes IS NULL OR artifactsMissingAt IS NOT NULL
         ORDER BY createdAt DESC LIMIT ?`
      )
      .all(limit) as ReportStorageRow[];
  }

  public estimateAttachmentCleanup(
    kind: AttachmentCleanupKind,
    cutoffISO: string
  ): { affectedRows: number; items: number; bytes: number; unmeasured: number } {
    return this.db.prepare(attachmentEstimateSql(kind)).get(cutoffISO) as {
      affectedRows: number;
      items: number;
      bytes: number;
      unmeasured: number;
    };
  }

  public estimateReportFilesCleanup(cutoffISO: string): { affectedRows: number; bytes: number } {
    return this.db
      .prepare(
        `SELECT count(*) AS affectedRows,
                COALESCE(SUM(CASE WHEN sizeBytes > 0 THEN sizeBytes ELSE 0 END), 0) AS bytes
         FROM reports
         WHERE ${EXPIRED_EXCEPT_OPEN_REGRESSIONS} AND artifactsMissingAt IS NULL`
      )
      .get(cutoffISO) as { affectedRows: number; bytes: number };
  }

  public estimateReportRecordCleanup(cutoffISO: string): {
    affectedRows: number;
    testRuns: number;
    analyses: number;
  } {
    return this.db
      .prepare(
        `SELECT count(*) AS affectedRows,
                COALESCE(SUM(
                  (SELECT count(*) FROM test_runs WHERE test_runs.reportId = reports.reportID)
                ), 0) AS testRuns
                ,
                COALESCE(SUM(
                  (SELECT count(*) FROM test_llm_analyses
                    WHERE test_llm_analyses.reportId = reports.reportID)
                ), 0) AS analyses
         FROM reports WHERE ${EXPIRED_EXCEPT_OPEN_REGRESSIONS}`
      )
      .get(cutoffISO) as { affectedRows: number; testRuns: number; analyses: number };
  }

  public getAttachmentCleanupCandidates(
    kind: AttachmentCleanupKind,
    cutoffISO: string,
    limit: number,
    after: CleanupCursor | null = null
  ): CleanupCandidate[] {
    return this.db
      .prepare(
        `SELECT reportID, storagePath, createdAt FROM reports
         WHERE ${EXPIRED_EXCEPT_OPEN_REGRESSIONS} AND ${DELETED_COLUMN[kind]} IS NULL
           AND artifactsMissingAt IS NULL
           AND ${hasAttachmentsOfKind(kind)}
           ${AFTER_CURSOR}
         ORDER BY createdAt ASC, reportID ASC LIMIT ?`
      )
      .all(cutoffISO, ...cursorParams(after), limit) as CleanupCandidate[];
  }

  public markAttachmentDeleted(
    kind: AttachmentCleanupKind,
    rows: Array<{ reportID: string; freedBytes: number }>
  ): void {
    this.writeBatched(
      `UPDATE reports
       SET ${DELETED_COLUMN[kind]} = ?, updatedAt = ?, sizeBytes = MAX(0, sizeBytes - ?)
       WHERE reportID = ? AND ${DELETED_COLUMN[kind]} IS NULL`,
      rows,
      (row, now) => [now, now, row.freedBytes, row.reportID]
    );
  }

  public getReportFilesCleanupCandidates(
    cutoffISO: string,
    limit: number,
    after: CleanupCursor | null = null
  ): Array<ReportPath & CleanupCursor> {
    return this.db
      .prepare(
        `SELECT reportID, project, storagePath, createdAt FROM reports
         WHERE ${EXPIRED_EXCEPT_OPEN_REGRESSIONS} AND artifactsMissingAt IS NULL
           ${AFTER_CURSOR}
         ORDER BY createdAt ASC, reportID ASC LIMIT ?`
      )
      .all(cutoffISO, ...cursorParams(after), limit) as Array<ReportPath & CleanupCursor>;
  }

  public clearArtifactsMissing(ids: string[]): void {
    this.writeBatched(
      'UPDATE reports SET artifactsMissingAt = NULL, updatedAt = ? WHERE reportID = ? AND artifactsMissingAt IS NOT NULL',
      ids,
      (id, now) => [now, id]
    );
  }

  public getArtifactState(reportID: string): ArtifactState | undefined {
    return this.db
      .prepare(
        `SELECT artifactsMissingAt, tracesDeletedAt, videosDeletedAt, screenshotsDeletedAt
         FROM reports WHERE reportID = ?`
      )
      .get(reportID) as ArtifactState | undefined;
  }

  public setAttachmentSizes(rows: Array<{ reportID: string; sizes: AttachmentSizes }>): void {
    this.writeBatched(
      'UPDATE reports SET attachmentSizes = ?, updatedAt = ? WHERE reportID = ?',
      rows,
      (row, now) => [JSON.stringify(row.sizes), now, row.reportID]
    );
  }

  public markStoragePruned(ids: string[]): void {
    this.writeBatched(
      `UPDATE reports SET sizeBytes = 0, size = '0.00 B', attachmentSizes = NULL, updatedAt = ?,
              artifactsMissingAt = COALESCE(artifactsMissingAt, ?)
       WHERE reportID = ?`,
      ids,
      (id, now) => [now, now, id]
    );
  }

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
    const compiled = applyReportFilters(
      this.k
        .selectFrom('reports')
        .select((eb) => [
          eb.fn.countAll<number>().as('count'),
          sql<number>`COALESCE(SUM(statTotal), 0)`.as('totalTests'),
          sql<number>`COALESCE(SUM(statExpected), 0)`.as('totalPassed'),
          sql<number>`COALESCE(SUM(statUnexpected), 0)`.as('totalFailed'),
          sql<number>`COALESCE(SUM(statFlaky), 0)`.as('totalFlaky'),
          sql<number>`COALESCE(SUM(durationMs), 0)`.as('sumDuration'),
        ]),
      project,
      { from, to, failedOnly: options.failedOnly }
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
            eb(eb.fn('LOWER', ['gitCommitHash']), 'like', pattern),
            eb(eb.fn('LOWER', ['gitCommitShortHash']), 'like', pattern),
            eb(eb.fn('LOWER', ['gitBranch']), 'like', pattern),
            eb(eb.fn('LOWER', ['gitCommitSubject']), 'like', pattern),
            eb.exists(
              eb
                .selectFrom('report_tags')
                .select((sub) => sub.lit(1).as('x'))
                .whereRef('report_tags.reportId', '=', 'reports.reportID')
                .where((inner) =>
                  inner.or([
                    inner('report_tags.key', 'like', pattern),
                    inner('report_tags.value', 'like', pattern),
                  ])
                )
            ),
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
            const term = `%${tag.trim()}%`;
            q = q.where((eb: ExpressionBuilder<Database, 'reports'>) =>
              eb.exists(
                eb
                  .selectFrom('report_tags')
                  .select((sub) => sub.lit(1).as('x'))
                  .whereRef('report_tags.reportId', '=', 'reports.reportID')
                  .where((inner) =>
                    inner.or([
                      inner('report_tags.key', 'like', term),
                      inner('report_tags.value', 'like', term),
                    ])
                  )
              )
            );
          } else {
            const key = tag.slice(0, colonIndex).trim();
            const value = tag.slice(colonIndex + 1).trim();
            q = q.where((eb: ExpressionBuilder<Database, 'reports'>) =>
              eb.exists(
                eb
                  .selectFrom('report_tags')
                  .select((sub) => sub.lit(1).as('x'))
                  .whereRef('report_tags.reportId', '=', 'reports.reportID')
                  .where('report_tags.key', '=', key)
                  .where('report_tags.value', '=', value)
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

    let listSelect = applyWhere(this.k.selectFrom('reports').select(REPORT_LIST_COLUMNS));
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
      parseCache.delete(key);
      parseCache.set(key, cached);
      baseDecoded = cached;
    } else {
      const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata, {});
      const stats = statsFromColumns(row);
      baseDecoded = {
        reportID: row.reportID,
        project: row.project,
        title: row.title || undefined,
        displayNumber: row.displayNumber || undefined,
        createdAt: row.createdAt,
        reportUrl: servedReportUrl(row),
        size: row.size || undefined,
        sizeBytes: row.sizeBytes,
        stats,
        storagePath: row.storagePath ?? undefined,
        ...metadata,
      } as unknown as ReportHistory;
      if (parseCache.size >= PARSE_CACHE_MAX) {
        const oldest = parseCache.keys().next().value;
        if (oldest !== undefined) parseCache.delete(oldest);
      }
      parseCache.set(key, baseDecoded);
    }

    return baseDecoded;
  }

  private rowToReportLite(
    row: Pick<
      ReportRow,
      | 'reportID'
      | 'project'
      | 'title'
      | 'displayNumber'
      | 'createdAt'
      | 'reportUrl'
      | 'size'
      | 'sizeBytes'
      | 'statTotal'
      | 'statExpected'
      | 'statUnexpected'
      | 'statFlaky'
      | 'statSkipped'
      | 'artifactsMissingAt'
    >
  ): ReportHistoryLite {
    return {
      reportID: row.reportID,
      project: row.project,
      title: row.title ?? undefined,
      displayNumber: row.displayNumber ?? undefined,
      createdAt: row.createdAt,
      reportUrl: servedReportUrl(row),
      size: row.size ?? undefined,
      sizeBytes: row.sizeBytes,
      stats: statsFromColumns(row),
    };
  }

  public findByDisplayNumber(displayNumber: number, project?: string): Array<ReportSummary> {
    let q = this.k
      .selectFrom('reports')
      .select([
        'reportID',
        'project',
        'title',
        'displayNumber',
        'createdAt',
        'reportUrl',
        'artifactsMissingAt',
      ])
      .where('displayNumber', '=', displayNumber)
      .orderBy('createdAt', 'desc');
    if (project) q = q.where('project', '=', project);
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as ReportSummaryRow[];
    return rows.map((row) => ({ ...row, reportUrl: servedReportUrl(row) }));
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
