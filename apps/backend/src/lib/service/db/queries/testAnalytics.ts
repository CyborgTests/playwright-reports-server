// Intentionally NOT migrated to the Kysely.compile().
// Uses complex analytics queries with:
//   - dynamic CTEs (window_w / cat_w) whose WHERE conditions vary by call site
//   - window functions (ROW_NUMBER OVER PARTITION BY) inside subqueries
//   - dynamic ORDER BY clauses with several CASE/COALESCE switches
//   - UNION ALL VALUES tuple lists for lane lookup
import type Database from 'better-sqlite3';
import type {
  DerivedPageRow,
  Test,
  TestRunRow,
  TestWithQuarantineInfoRow,
} from '../tests.sqlite.js';
import { convertDbRowToTestRun, type TestRunDbRow } from '../tests.sqlite.js';

export interface DerivedPageOptions {
  status?: 'all' | 'quarantined' | 'not-quarantined';
  sort?: 'default' | 'slowest' | 'stale' | 'regression-age';
  tier?: {
    warningThreshold: number;
    quarantineThreshold: number;
    tiers: Array<'stable' | 'flaky' | 'critical'>;
  };
  failureCategory?: string;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
  search?: string;
  regressedOnly?: boolean;
  regressedSince?: string;
  resolvedSince?: string;
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

function scopedRunFilter(
  project: string | undefined,
  from?: string,
  to?: string,
  opts: { excludeSkipped?: boolean; requireDuration?: boolean; alias?: string } = {}
): { where: string; params: Array<string | number> } {
  const a = opts.alias ? `${opts.alias}.` : '';
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (opts.excludeSkipped !== false) conditions.push(`${a}outcome != 'skipped'`);
  if (opts.requireDuration !== false) conditions.push(`${a}duration IS NOT NULL`);
  if (project && project !== 'all') {
    conditions.push(`${a}project = ?`);
    params.push(project);
  }
  if (from) {
    conditions.push(`${a}createdAt >= ?`);
    params.push(from);
  }
  if (to) {
    conditions.push(`${a}createdAt < ?`);
    params.push(to);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export function getDerivedPage(
  db: Database.Database,
  project: string | undefined,
  options: DerivedPageOptions = {}
): { rows: DerivedPageRow[]; total: number } {
  const scoped = !!project && project !== 'all';
  const windowed = !!(options.from || options.to);

  const ctes: string[] = [];
  const cteParams: Array<string | number> = [];
  if (windowed) {
    // Build the window filter's SQL and its bind params together so the two
    // reuses (window_w / cat_w) can't desync: each CTE appends exactly
    // the params for the `?` placeholders it just emitted.
    const windowFilter = (
      failureCategory?: string
    ): { sql: string; params: Array<string | number> } => {
      const conds = ["outcome != 'skipped'"];
      const params: Array<string | number> = [];
      if (scoped) {
        conds.push('project = ?');
        params.push(project as string);
      }
      if (options.from) {
        conds.push('createdAt >= ?');
        params.push(options.from);
      }
      if (options.to) {
        conds.push('createdAt < ?');
        params.push(options.to);
      }
      if (failureCategory) {
        conds.push('failure_category = ?');
        params.push(failureCategory);
      }
      return { sql: conds.join(' AND '), params };
    };

    const windowAggregateFilter = windowFilter();
    ctes.push(`window_w AS (
      SELECT testId, fileId, project,
             COUNT(*) AS totalRuns,
             MAX(createdAt) AS lastRunAt,
             CAST(SUM(CASE WHEN outcome IN ('expected', 'passed') THEN 1 ELSE 0 END) AS REAL)
               / NULLIF(COUNT(*), 0) AS recentPassRate,
             AVG(CASE WHEN duration >= 0 THEN duration END) AS avgDuration
      FROM test_runs WHERE ${windowAggregateFilter.sql}
      GROUP BY testId, fileId, project
    )`);
    cteParams.push(...windowAggregateFilter.params);

    if (options.failureCategory) {
      const catFilter = windowFilter(options.failureCategory);
      ctes.push(`cat_w AS (
        SELECT DISTINCT testId, fileId, project
        FROM test_runs WHERE ${catFilter.sql}
      )`);
      cteParams.push(...catFilter.params);
    }
  }

  const totalRunsExpr = windowed ? 'COALESCE(window_w.totalRuns, 0)' : 'COALESCE(t.totalRuns, 0)';
  const lastRunAtExpr = windowed ? 'window_w.lastRunAt' : 't.latestRunAt';
  const passRateExpr = windowed
    ? 'COALESCE(window_w.recentPassRate, 1.0)'
    : 'COALESCE(t.recentPassRate, 1.0)';
  const avgDurationExpr = windowed ? 'window_w.avgDuration' : 't.avgDuration';

  const whereConds: string[] = [];
  const whereParams: Array<string | number> = [];

  if (scoped) {
    whereConds.push('t.project = ?');
    whereParams.push(project as string);
  }
  if (windowed && !options.resolvedSince && !options.regressedSince) {
    whereConds.push('window_w.totalRuns IS NOT NULL AND window_w.totalRuns > 0');
  }
  if (options.status === 'quarantined') {
    whereConds.push('COALESCE(t.quarantined, 0) = 1');
  } else if (options.status === 'not-quarantined') {
    whereConds.push('COALESCE(t.quarantined, 0) = 0');
  }
  if (options.tier && options.tier.tiers.length > 0) {
    const { warningThreshold, quarantineThreshold, tiers } = options.tier;
    const tierConds: string[] = [];
    for (const tier of tiers) {
      if (tier === 'stable') {
        tierConds.push('COALESCE(t.flakinessScore, 0) < ?');
        whereParams.push(warningThreshold);
      } else if (tier === 'flaky') {
        tierConds.push(
          '(COALESCE(t.flakinessScore, 0) >= ? AND COALESCE(t.flakinessScore, 0) < ?)'
        );
        whereParams.push(warningThreshold, quarantineThreshold);
      } else if (tier === 'critical') {
        tierConds.push('COALESCE(t.flakinessScore, 0) >= ?');
        whereParams.push(quarantineThreshold);
      }
    }
    if (tierConds.length > 0) whereConds.push(`(${tierConds.join(' OR ')})`);
  }
  if (options.failureCategory) {
    if (windowed) {
      whereConds.push(
        '(t.testId, t.fileId, t.project) IN (SELECT testId, fileId, project FROM cat_w)'
      );
    } else {
      whereConds.push('t.latestFailureCategory = ?');
      whereParams.push(options.failureCategory);
    }
  }
  if (options.search) {
    const term = options.search.trim();
    if (term.length >= 3) {
      whereConds.push(
        `(t.testId, t.fileId, t.project) IN (
          SELECT testId, fileId, project FROM tests_fts WHERE tests_fts MATCH ?
        )`
      );
      whereParams.push(`"${term.replace(/"/g, '""')}"`);
    } else if (term.length > 0) {
      const like = `%${escapeLikeTerm(term.toLowerCase())}%`;
      whereConds.push(
        `(LOWER(t.title) LIKE ? ESCAPE '\\' OR LOWER(t.filePath) LIKE ? ESCAPE '\\'
          OR LOWER(t.tags) LIKE ? ESCAPE '\\')`
      );
      whereParams.push(like, like, like);
    }
  }

  if (options.regressedOnly) {
    whereConds.push(`EXISTS (
      SELECT 1 FROM regressions r
      WHERE r.testId = t.testId AND r.fileId = t.fileId AND r.project = t.project
        AND r.recoveredAtReportId IS NULL
    )`);
    whereConds.push('COALESCE(t.quarantined, 0) = 0');
    whereConds.push(`COALESCE(t.latestOutcome, '') != 'skipped'`);
  }
  if (options.regressedSince) {
    whereConds.push(`EXISTS (
      SELECT 1 FROM regressions r
      WHERE r.testId = t.testId AND r.fileId = t.fileId AND r.project = t.project
        AND r.regressedAtCreatedAt >= ?
    )`);
    whereParams.push(options.regressedSince);
  }
  if (options.resolvedSince) {
    whereConds.push(`EXISTS (
      SELECT 1 FROM regressions r
      WHERE r.testId = t.testId AND r.fileId = t.fileId AND r.project = t.project
        AND r.recoveredAtReportId IS NOT NULL
        AND r.recoveredAtCreatedAt >= ?
    )`);
    whereParams.push(options.resolvedSince);
  }

  const tieBreaker = 't.createdAt DESC, t.rowid';
  let orderBy: string;
  if (options.sort === 'slowest') {
    orderBy = `ORDER BY COALESCE(${avgDurationExpr}, -1) DESC, ${tieBreaker}`;
  } else if (options.sort === 'stale') {
    orderBy = `ORDER BY COALESCE(${lastRunAtExpr}, '') ASC, ${tieBreaker}`;
  } else if (options.sort === 'regression-age') {
    orderBy = `ORDER BY (
      SELECT MIN(r.regressedAtCreatedAt) FROM regressions r
      WHERE r.testId = t.testId AND r.fileId = t.fileId AND r.project = t.project
        AND r.recoveredAtReportId IS NULL
    ) ASC, ${tieBreaker}`;
  } else {
    orderBy = `ORDER BY
      CASE WHEN t.latestOutcome = 'skipped' THEN 1 ELSE 0 END ASC,
      CASE WHEN t.latestOutcome = 'unexpected' THEN 0 ELSE 1 END ASC,
      COALESCE(t.flakinessScore, 0) DESC,
      ${passRateExpr} ASC,
      ${tieBreaker}`;
  }

  const whereSql = whereConds.length ? `WHERE ${whereConds.join(' AND ')}` : '';
  const windowJoins = windowed
    ? `
      LEFT JOIN window_w
        ON window_w.testId = t.testId AND window_w.fileId = t.fileId
          AND window_w.project = t.project`
    : '';
  const baseFrom = `FROM tests t ${windowJoins} ${whereSql}`;

  const pageParams: Array<string | number> = [];
  let limitSql = '';
  if (options.limit !== undefined) {
    limitSql = 'LIMIT ? OFFSET ?';
    pageParams.push(options.limit, options.offset ?? 0);
  }

  const cteHead = ctes.length > 0 ? `WITH ${ctes.join(', ')}` : '';

  const rowsSql = `${cteHead}
    SELECT
      t.testId, t.fileId, t.filePath, t.project, t.title, t.createdAt, t.tags, t.latestAnnotations,
      ${totalRunsExpr} AS totalRuns,
      ${lastRunAtExpr} AS lastRunAt,
      t.latestOutcome AS latestOutcome,
      t.flakinessScore AS flakinessScore,
      COALESCE(t.quarantined, 0) AS quarantined,
      t.latestNonSkippedAt AS latestNonSkippedAt,
      t.quarantineReason AS quarantineReason,
      ${passRateExpr} AS recentPassRate,
      ${avgDurationExpr} AS avgDuration,
      t.flakinessResetAt AS flakinessResetAt,
      COUNT(*) OVER () AS __total
    ${baseFrom}
    ${orderBy}
    ${limitSql}
  `;
  const rawRows = db.prepare(rowsSql).all(...cteParams, ...whereParams, ...pageParams) as Array<
    DerivedPageRow & { __total: number }
  >;
  let total = rawRows.length > 0 ? rawRows[0].__total : 0;
  const rows = rawRows.map(({ __total, ...row }) => row);

  if (rawRows.length === 0 && (options.offset ?? 0) > 0) {
    const countSql = `${cteHead} SELECT COUNT(*) AS total ${baseFrom}`;
    const countRow = db.prepare(countSql).get(...cteParams, ...whereParams) as
      | { total: number }
      | undefined;
    total = countRow?.total ?? 0;
  }

  return { rows, total };
}

export const LANE_HISTORY_LIMIT = 30;

export function getRunsForLanes(
  db: Database.Database,
  lanes: Array<{ testId: string; fileId: string; project: string }>,
  opts?: { from?: string; to?: string }
): Map<string, TestRunRow[]> {
  const map = new Map<string, TestRunRow[]>();
  if (lanes.length === 0) return map;

  const conditions = ['testId = ?', 'fileId = ?', 'project = ?'];
  if (opts?.from) conditions.push('createdAt >= ?');
  if (opts?.to) conditions.push('createdAt < ?');
  const statement = db.prepare(
    `SELECT runId, outcome, duration, createdAt, failure_category, reportId
     FROM test_runs
     WHERE ${conditions.join(' AND ')}
     ORDER BY createdAt DESC
     LIMIT ${LANE_HISTORY_LIMIT}`
  );
  const windowParameters = [opts?.from, opts?.to].filter((v): v is string => !!v);

  type LaneRunRow = Pick<
    TestRunDbRow,
    'runId' | 'outcome' | 'duration' | 'createdAt' | 'reportId'
  > & { failure_category: string | null };

  for (const lane of lanes) {
    const rows = statement.all(
      lane.testId,
      lane.fileId,
      lane.project,
      ...windowParameters
    ) as LaneRunRow[];
    map.set(
      `${lane.testId}::${lane.fileId}::${lane.project}`,
      rows.map((row) => ({
        runId: row.runId,
        testId: lane.testId,
        fileId: lane.fileId,
        project: lane.project,
        reportId: row.reportId,
        outcome: row.outcome,
        duration: row.duration ?? undefined,
        createdAt: row.createdAt,
        failureCategory: row.failure_category || undefined,
      }))
    );
  }
  return map;
}

export function getTestsSummary(
  db: Database.Database,
  project: string | undefined,
  warningThreshold: number
): { total: number; flakyTests: TestWithQuarantineInfoRow[] } {
  const scoped = !!project && project !== 'all';
  const projectClause = scoped ? 'WHERE project = ?' : '';
  const projectClauseAnd = scoped ? 'AND project = ?' : '';

  const totalRow = db
    .prepare(`SELECT COUNT(DISTINCT testId) AS total FROM tests ${projectClause}`)
    .get(...(scoped ? [project] : [])) as { total: number };

  const flakyRows = db
    .prepare(
      `SELECT testId, fileId, filePath, project, title, createdAt,
              flakinessScore, quarantined
       FROM tests
       WHERE flakinessScore IS NOT NULL AND flakinessScore >= ? ${projectClauseAnd}`
    )
    .all(...(scoped ? [warningThreshold, project] : [warningThreshold])) as Array<
    Test & { flakinessScore: number; quarantined: number }
  >;

  const flakyTests: TestWithQuarantineInfoRow[] = flakyRows.map((row) => ({
    testId: row.testId,
    fileId: row.fileId,
    filePath: row.filePath,
    project: row.project,
    title: row.title,
    createdAt: row.createdAt,
    flakinessScore: row.flakinessScore,
    isQuarantined: Boolean(row.quarantined),
  }));

  return { total: totalRow?.total ?? 0, flakyTests };
}

export function getDurationAggregates(
  db: Database.Database,
  project: string | undefined,
  from?: string,
  to?: string
): { avgDuration: number; p95Duration: number; count: number } {
  const { where, params } = scopedRunFilter(project, from, to);
  const agg = db
    .prepare(`SELECT AVG(duration) AS avg, COUNT(*) AS count FROM test_runs ${where}`)
    .get(...params) as { avg: number | null; count: number };
  const count = agg?.count ?? 0;
  if (count === 0) {
    return { avgDuration: 0, p95Duration: 0, count: 0 };
  }
  // traverse p95 from desc offset as we display slowest records only.
  const ascOffset = Math.min(count - 1, Math.floor(count * 0.95));
  const descOffset = count - 1 - ascOffset;
  const p95Row = db
    .prepare(`SELECT duration FROM test_runs ${where} ORDER BY duration DESC LIMIT 1 OFFSET ?`)
    .get(...params, descOffset) as { duration: number | null } | undefined;
  return {
    avgDuration: agg.avg ?? 0,
    p95Duration: p95Row?.duration ?? 0,
    count,
  };
}

export function getSlowestTests(
  db: Database.Database,
  project: string | undefined,
  from: string | undefined,
  to: string | undefined,
  limit: number
): Array<{ step: string; duration: number; testId: string }> {
  const { where, params } = scopedRunFilter(project, from, to, { alias: 'tr' });
  const sql = `
    SELECT t.title AS step, tr.duration AS duration, tr.testId AS testId
    FROM test_runs tr
    JOIN tests t ON t.testId = tr.testId AND t.fileId = tr.fileId AND t.project = tr.project
    ${where}
    ORDER BY tr.duration DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit) as Array<{
    step: string | null;
    duration: number;
    testId: string;
  }>;
  return rows.map((r) => ({
    step: r.step ?? 'Unknown Test',
    duration: r.duration,
    testId: r.testId,
  }));
}

export function getSlowCountsByReport(
  db: Database.Database,
  project: string | undefined,
  from: string | undefined,
  to: string | undefined,
  threshold: number
): Map<string, number> {
  const { where, params } = scopedRunFilter(project, from, to);
  const extra = where ? `${where} AND duration > ?` : 'WHERE duration > ?';
  const rows = db
    .prepare(`SELECT reportId, COUNT(*) AS count FROM test_runs ${extra} GROUP BY reportId`)
    .all(...params, threshold) as Array<{ reportId: string; count: number }>;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.reportId, row.count);
  return map;
}

export function getFlakySummaryInWindow(
  db: Database.Database,
  project: string | undefined,
  from: string,
  to: string,
  warningThreshold: number
): { total: number; flakyCount: number } {
  const scoped = project && project !== 'all';

  const flakyRow = db
    .prepare(
      `SELECT COUNT(DISTINCT t.testId) AS flakyCount
       FROM tests t
       WHERE COALESCE(t.flakinessScore, 0) >= ? ${scoped ? 'AND t.project = ?' : ''}
         AND EXISTS (
           SELECT 1 FROM test_runs tr
           WHERE tr.testId = t.testId AND tr.fileId = t.fileId AND tr.project = t.project
             AND tr.outcome != 'skipped' AND tr.createdAt >= ? AND tr.createdAt < ?
         )`
    )
    .get(...(scoped ? [warningThreshold, project, from, to] : [warningThreshold, from, to])) as {
    flakyCount: number;
  };

  const totalRow = db
    .prepare(
      `SELECT COUNT(DISTINCT testId) AS total FROM test_runs
       WHERE outcome != 'skipped' AND createdAt >= ? AND createdAt < ? ${scoped ? 'AND project = ?' : ''}`
    )
    .get(...(scoped ? [from, to, project] : [from, to])) as { total: number };

  return { total: totalRow?.total ?? 0, flakyCount: flakyRow?.flakyCount ?? 0 };
}

export function getTopFailingTestsInWindow(
  db: Database.Database,
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
  const scoped = !!project && project !== 'all';
  const projectClause = scoped ? 'AND tr.project = ?' : '';
  const params: Array<string | number> = [from, to];
  if (scoped) params.push(project);
  params.push(limit);

  const sql = `
    SELECT tr.testId, tr.fileId, tr.project,
           COALESCE(t.title, tr.testId) AS title,
           COUNT(*) AS failureCount
    FROM test_runs tr
    LEFT JOIN tests t ON t.testId = tr.testId AND t.fileId = tr.fileId AND t.project = tr.project
    WHERE tr.outcome IN ('failed', 'unexpected')
      AND tr.createdAt >= ? AND tr.createdAt < ?
      ${projectClause}
    GROUP BY tr.testId, tr.fileId, tr.project
    ORDER BY failureCount DESC, title ASC
    LIMIT ?
  `;
  return db.prepare(sql).all(...params) as Array<{
    testId: string;
    fileId: string;
    project: string;
    title: string;
    failureCount: number;
  }>;
}

export function getFlakiestTestsInWindow(
  db: Database.Database,
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
  const scoped = !!project && project !== 'all';
  const outerProjectClause = scoped ? 'AND t.project = ?' : '';
  const innerProjectClause = scoped ? 'AND tr.project = ?' : '';

  const params: Array<string | number> = [minScore];
  if (scoped) params.push(project);
  params.push(from, to);
  if (scoped) params.push(project);
  params.push(limit);

  const sql = `
    SELECT t.testId, t.fileId, t.project, t.title, t.flakinessScore AS flakinessScore
    FROM tests t
    WHERE t.flakinessScore IS NOT NULL
      AND t.flakinessScore >= ?
      ${outerProjectClause}
      AND EXISTS (
        SELECT 1 FROM test_runs tr
        WHERE tr.testId = t.testId AND tr.fileId = t.fileId AND tr.project = t.project
          AND tr.createdAt >= ? AND tr.createdAt < ?
          ${innerProjectClause}
      )
    ORDER BY t.flakinessScore DESC, t.title ASC
    LIMIT ?
  `;
  return db.prepare(sql).all(...params) as Array<{
    testId: string;
    fileId: string;
    project: string;
    title: string;
    flakinessScore: number;
  }>;
}

export function getTestRunsInWindow(
  db: Database.Database,
  project: string | undefined,
  from: string,
  to: string
): TestRunRow[] {
  const conditions: string[] = ["tr.outcome != 'skipped'"];
  const params: string[] = [];

  conditions.push('tr.createdAt >= ?');
  params.push(from);
  conditions.push('tr.createdAt < ?');
  params.push(to);

  if (project && project !== 'all') {
    conditions.push('tr.project = ?');
    params.push(project);
  }

  const sql = `
    SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber
    FROM test_runs tr
    LEFT JOIN reports r ON r.reportID = tr.reportId
    WHERE ${conditions.join(' AND ')}
    ORDER BY tr.createdAt DESC
  `;
  const rows = db.prepare(sql).all(...params) as TestRunDbRow[];
  return rows.map((row) => convertDbRowToTestRun(row));
}
