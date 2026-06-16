// Intentionally NOT migrated to the Kysely.compile().
// Uses complex analytics queries with:
//   - dynamic CTEs (agg_w / recent_w) whose WHERE conditions vary by call site
//   - window functions (ROW_NUMBER OVER PARTITION BY) inside subqueries
//   - dynamic ORDER BY clauses with several CASE/COALESCE switches
//   - UNION ALL VALUES tuple lists for lane lookup
import type Database from 'better-sqlite3';
import type { DerivedPageRow, Test, TestRun, TestWithQuarantineInfo } from '../tests.sqlite.js';
import { convertDbRowToTestRun, type TestRunDbRow } from '../tests.sqlite.js';
import { chunk } from '../utils.js';

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
    const winConds = ["outcome != 'skipped'"];
    if (scoped) {
      winConds.push('project = ?');
      cteParams.push(project as string);
    }
    if (options.from) {
      winConds.push('createdAt >= ?');
      cteParams.push(options.from);
    }
    if (options.to) {
      winConds.push('createdAt < ?');
      cteParams.push(options.to);
    }
    ctes.push(`agg_w AS (
      SELECT testId, fileId, project, COUNT(*) AS totalRuns, MAX(createdAt) AS lastRunAt
      FROM test_runs WHERE ${winConds.join(' AND ')}
      GROUP BY testId, fileId, project
    )`);
    // recent_w reuses the same filters as agg_w; duplicate the bind params
    // in the same order to align with the second occurrence of winConds.
    if (scoped) cteParams.push(project as string);
    if (options.from) cteParams.push(options.from);
    if (options.to) cteParams.push(options.to);
    ctes.push(`recent_w AS (
      SELECT testId, fileId, project,
             CAST(SUM(CASE WHEN outcome IN ('expected', 'passed') THEN 1 ELSE 0 END) AS REAL)
               / NULLIF(COUNT(*), 0) AS recentPassRate,
             AVG(CASE WHEN duration >= 0 THEN duration END) AS avgDuration
      FROM test_runs WHERE ${winConds.join(' AND ')}
      GROUP BY testId, fileId, project
    )`);
    if (options.failureCategory) {
      const catConds = [...winConds, 'failure_category = ?'];
      if (scoped) cteParams.push(project as string);
      if (options.from) cteParams.push(options.from);
      if (options.to) cteParams.push(options.to);
      cteParams.push(options.failureCategory);
      ctes.push(`cat_w AS (
        SELECT DISTINCT testId, fileId, project
        FROM test_runs WHERE ${catConds.join(' AND ')}
      )`);
    }
  }

  const totalRunsExpr = windowed ? 'COALESCE(agg_w.totalRuns, 0)' : 'COALESCE(t.totalRuns, 0)';
  const lastRunAtExpr = windowed ? 'agg_w.lastRunAt' : 't.latestRunAt';
  const passRateExpr = windowed
    ? 'COALESCE(recent_w.recentPassRate, 1.0)'
    : 'COALESCE(t.recentPassRate, 1.0)';
  const avgDurationExpr = windowed ? 'recent_w.avgDuration' : 't.avgDuration';

  const whereConds: string[] = [];
  const whereParams: Array<string | number> = [];

  if (scoped) {
    whereConds.push('t.project = ?');
    whereParams.push(project as string);
  }
  if (windowed && !options.resolvedSince && !options.regressedSince) {
    whereConds.push('agg_w.totalRuns IS NOT NULL AND agg_w.totalRuns > 0');
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
      // FTS5 with the trigram tokenizer accelerates substring search
      // ("contains" anywhere in title or filePath) via an inverted index.
      // The user's input is quoted as a phrase so any FTS5 query-syntax
      // metacharacters (-, :, (, NEAR, etc.) are treated as literal text.
      const phrase = `"${term.replace(/"/g, '""')}"`;
      whereConds.push(
        `(t.testId, t.fileId, t.project) IN (
          SELECT testId, fileId, project FROM tests_fts WHERE tests_fts MATCH ?
        )`
      );
      whereParams.push(phrase);
    } else if (term.length > 0) {
      // Trigram FTS can't tokenize inputs shorter than 3 chars, so fall
      // back to a LIKE scan for very short search prefixes.
      const like = `%${term.toLowerCase()}%`;
      whereConds.push('(LOWER(t.title) LIKE ? OR LOWER(t.filePath) LIKE ?)');
      whereParams.push(like, like);
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
      LEFT JOIN agg_w
        ON agg_w.testId = t.testId AND agg_w.fileId = t.fileId AND agg_w.project = t.project
      LEFT JOIN recent_w
        ON recent_w.testId = t.testId AND recent_w.fileId = t.fileId
          AND recent_w.project = t.project`
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
      t.testId, t.fileId, t.filePath, t.project, t.title, t.createdAt,
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

const LANE_CHUNK_SIZE = 5000;

export function getRunsForLanes(
  db: Database.Database,
  lanes: Array<{ testId: string; fileId: string; project: string }>,
  opts?: { from?: string; to?: string }
): Map<string, TestRun[]> {
  if (lanes.length === 0) return new Map();

  const map = new Map<string, TestRun[]>();
  for (const batch of chunk(lanes, LANE_CHUNK_SIZE)) {
    runsForLaneChunk(db, batch, opts, map);
  }
  return map;
}

function runsForLaneChunk(
  db: Database.Database,
  lanes: Array<{ testId: string; fileId: string; project: string }>,
  opts: { from?: string; to?: string } | undefined,
  out: Map<string, TestRun[]>
): void {
  const windowed = !!(opts?.from || opts?.to);
  const laneRows = lanes
    .map(() => 'SELECT ? AS testId, ? AS fileId, ? AS project')
    .join(' UNION ALL ');
  const params: Array<string | number> = lanes.flatMap((l) => [l.testId, l.fileId, l.project]);

  let sql: string;
  if (windowed) {
    const winConds = ["tr.outcome != 'skipped'"];
    if (opts?.from) {
      winConds.push('tr.createdAt >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      winConds.push('tr.createdAt < ?');
      params.push(opts.to);
    }
    sql = `
      WITH lanes(testId, fileId, project) AS (${laneRows})
      SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber
      FROM test_runs tr
      JOIN lanes l
        ON l.testId = tr.testId AND l.fileId = tr.fileId AND l.project = tr.project
      LEFT JOIN reports r ON r.reportID = tr.reportId
      WHERE ${winConds.join(' AND ')}
      ORDER BY tr.testId, tr.fileId, tr.project, tr.createdAt DESC
    `;
  } else {
    sql = `
      WITH lanes(testId, fileId, project) AS (${laneRows})
      SELECT testId, fileId, project, runId, outcome, duration, createdAt,
             flakinessScore, quarantineReason, quarantined, fixedAt,
             failure_details, failure_category, failure_category_source,
             error_signature, error_signature_global,
             reportId, reportTitle, reportDisplayNumber
      FROM (
        SELECT tr.*, r.title AS reportTitle, r.displayNumber AS reportDisplayNumber,
               ROW_NUMBER() OVER (
                 PARTITION BY tr.testId, tr.fileId, tr.project
                 ORDER BY tr.createdAt DESC
               ) AS rn
        FROM test_runs tr
        JOIN lanes l
          ON l.testId = tr.testId AND l.fileId = tr.fileId AND l.project = tr.project
        LEFT JOIN reports r ON r.reportID = tr.reportId
      )
      WHERE rn <= 50
      ORDER BY testId, fileId, project, createdAt DESC
    `;
  }

  const runRows = db.prepare(sql).all(...params) as TestRunDbRow[];
  for (const row of runRows) {
    const key = `${row.testId}::${row.fileId}::${row.project}`;
    let bucket = out.get(key);
    if (!bucket) {
      bucket = [];
      out.set(key, bucket);
    }
    bucket.push(convertDbRowToTestRun(row));
  }
}

export function getTestsSummary(
  db: Database.Database,
  project: string | undefined,
  warningThreshold: number
): { total: number; flakyTests: TestWithQuarantineInfo[] } {
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

  const flakyTests: TestWithQuarantineInfo[] = flakyRows.map((row) => ({
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
  const offset = Math.min(count - 1, Math.floor(count * 0.95));
  const p95Row = db
    .prepare(`SELECT duration FROM test_runs ${where} ORDER BY duration ASC LIMIT 1 OFFSET ?`)
    .get(...params, offset) as { duration: number | null } | undefined;
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
  const projectClauseInWindow = scoped ? 'AND project = ?' : '';

  const totalRow = db
    .prepare(
      `SELECT COUNT(DISTINCT testId) AS total FROM test_runs
       WHERE outcome != 'skipped' AND createdAt >= ? AND createdAt < ? ${projectClauseInWindow}`
    )
    .get(...(scoped ? [from, to, project] : [from, to])) as { total: number };

  const flakyRow = db
    .prepare(
      `SELECT COUNT(DISTINCT iw.testId) AS flakyCount
       FROM (
         SELECT DISTINCT testId, fileId, project FROM test_runs
         WHERE outcome != 'skipped' AND createdAt >= ? AND createdAt < ? ${projectClauseInWindow}
       ) iw
       JOIN tests t USING (testId, fileId, project)
       WHERE COALESCE(t.flakinessScore, 0) >= ?`
    )
    .get(...(scoped ? [from, to, project, warningThreshold] : [from, to, warningThreshold])) as {
    flakyCount: number;
  };

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
): TestRun[] {
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
