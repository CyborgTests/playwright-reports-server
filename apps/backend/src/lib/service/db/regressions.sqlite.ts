import { randomUUID } from 'node:crypto';
import type { TestDetailRegression } from '@playwright-reports/shared';
import { getDatabase } from './db.js';
import type { RegressionsRow } from './kysely.js';
import { singletonOf } from './singleton.js';

export type RegressionRow = RegressionsRow;

export function toRegressionContext(reg: RegressionSummary): TestDetailRegression {
  return {
    regressedAt: reg.regressedAtCreatedAt,
    regressedAtCommit: reg.regressedAtCommit ?? undefined,
    lastGreenCommit: reg.lastGreenCommit ?? undefined,
    daysOpen: reg.daysOpen,
    failureCount: reg.failureCount,
    flakyCount: reg.flakyCount,
  };
}

export interface RegressionSummary {
  id: string;
  regressedAtReportId: string;
  regressedAtCreatedAt: string;
  regressedAtCommit: string | null;
  regressedAtCategory: string | null;
  regressedAtDisplayNumber: number | null;
  lastGreenReportId: string | null;
  lastGreenCreatedAt: string | null;
  lastGreenCommit: string | null;
  lastGreenDisplayNumber: number | null;
  daysOpen: number;
  failureCount: number;
  flakyCount: number;
}

interface OpenForTestRow {
  id: string;
  regressedAtReportId: string;
  regressedAtCreatedAt: string;
  regressedAtCommit: string | null;
  regressedAtCategory: string | null;
  regressedDisplayNumber: number | null;
  lastGreenReportId: string | null;
  lastGreenCreatedAt: string | null;
  lastGreenCommit: string | null;
  lastGreenDisplayNumber: number | null;
  failureCount: number;
  flakyCount: number;
}

export interface ListFilters {
  project?: string;
  open?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  sort?: 'impact' | 'recent' | 'oldest';
}

export interface RegressionListItem extends RegressionRow {
  title: string | null;
  filePath: string | null;
  regressedDisplayNumber: number | null;
  lastGreenDisplayNumber: number | null;
}

export class RegressionsDatabase {
  private readonly db = getDatabase();

  public getOpenForTest(testId: string, fileId: string, project: string): RegressionSummary | null {
    const sqlText = `
      SELECT r.id, r.regressedAtReportId, r.regressedAtCreatedAt,
             r.regressedAtCommit, r.regressedAtCategory,
             r.lastGreenReportId, r.lastGreenCreatedAt, r.lastGreenCommit,
             r.failureCount, r.flakyCount,
             rep.displayNumber AS regressedDisplayNumber,
             green.displayNumber AS lastGreenDisplayNumber
      FROM regressions r
      JOIN tests t ON t.testId = r.testId AND t.fileId = r.fileId AND t.project = r.project
      LEFT JOIN reports rep ON rep.reportID = r.regressedAtReportId
      LEFT JOIN reports green ON green.reportID = r.lastGreenReportId
      WHERE r.testId = ? AND r.fileId = ? AND r.project = ?
        AND r.recoveredAtReportId IS NULL
        AND COALESCE(t.quarantined, 0) = 0
        AND COALESCE(t.latestOutcome, '') != 'skipped'
      ORDER BY r.regressedAtCreatedAt DESC
      LIMIT 1
    `;
    const row = this.db.prepare(sqlText).get(testId, fileId, project) as OpenForTestRow | undefined;
    if (!row) return null;
    const daysOpen = (Date.now() - Date.parse(row.regressedAtCreatedAt)) / 86_400_000;
    return {
      id: row.id,
      regressedAtReportId: row.regressedAtReportId,
      regressedAtCreatedAt: row.regressedAtCreatedAt,
      regressedAtCommit: row.regressedAtCommit,
      regressedAtCategory: row.regressedAtCategory,
      regressedAtDisplayNumber: row.regressedDisplayNumber,
      lastGreenReportId: row.lastGreenReportId,
      lastGreenCreatedAt: row.lastGreenCreatedAt,
      lastGreenCommit: row.lastGreenCommit,
      lastGreenDisplayNumber: row.lastGreenDisplayNumber,
      daysOpen,
      failureCount: row.failureCount,
      flakyCount: row.flakyCount,
    };
  }

  public getOpenForTests(
    keys: Array<{ testId: string; fileId: string; project: string }>
  ): Map<string, RegressionSummary> {
    const out = new Map<string, RegressionSummary>();
    if (keys.length === 0) return out;
    const BATCH = 200;
    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      const valuesRows = slice.map(() => '(?, ?, ?)').join(',');
      const params: string[] = [];
      for (const k of slice) {
        params.push(k.testId, k.fileId, k.project);
      }
      const sqlText = `
        WITH keys(testId, fileId, project) AS (VALUES ${valuesRows})
        SELECT r.id, r.testId, r.fileId, r.project,
               r.regressedAtReportId, r.regressedAtCreatedAt,
               r.regressedAtCommit, r.regressedAtCategory,
               r.lastGreenReportId, r.lastGreenCreatedAt, r.lastGreenCommit,
               r.failureCount, r.flakyCount,
               rep.displayNumber AS regressedDisplayNumber,
               green.displayNumber AS lastGreenDisplayNumber
        FROM keys k
        JOIN regressions r
          ON r.testId = k.testId AND r.fileId = k.fileId AND r.project = k.project
        JOIN tests t
          ON t.testId = r.testId AND t.fileId = r.fileId AND t.project = r.project
        LEFT JOIN reports rep ON rep.reportID = r.regressedAtReportId
        LEFT JOIN reports green ON green.reportID = r.lastGreenReportId
        WHERE r.recoveredAtReportId IS NULL
          AND COALESCE(t.quarantined, 0) = 0
          AND COALESCE(t.latestOutcome, '') != 'skipped'
      `;
      const rows = this.db.prepare(sqlText).all(...params) as Array<
        OpenForTestRow & { testId: string; fileId: string; project: string }
      >;
      for (const row of rows) {
        const daysOpen = (Date.now() - Date.parse(row.regressedAtCreatedAt)) / 86_400_000;
        out.set(`${row.testId}::${row.fileId}::${row.project}`, {
          id: row.id,
          regressedAtReportId: row.regressedAtReportId,
          regressedAtCreatedAt: row.regressedAtCreatedAt,
          regressedAtCommit: row.regressedAtCommit,
          regressedAtCategory: row.regressedAtCategory,
          regressedAtDisplayNumber: row.regressedDisplayNumber,
          lastGreenReportId: row.lastGreenReportId,
          lastGreenCreatedAt: row.lastGreenCreatedAt,
          lastGreenCommit: row.lastGreenCommit,
          lastGreenDisplayNumber: row.lastGreenDisplayNumber,
          daysOpen,
          failureCount: row.failureCount,
          flakyCount: row.flakyCount,
        });
      }
    }
    return out;
  }

  public list(filters: ListFilters): { data: RegressionListItem[]; total: number } {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filters.project) {
      where.push('r.project = ?');
      params.push(filters.project);
    }
    if (filters.open === true) {
      where.push('r.recoveredAtReportId IS NULL');
    } else if (filters.open === false) {
      where.push('r.recoveredAtReportId IS NOT NULL');
    }
    if (filters.since) {
      where.push('r.regressedAtCreatedAt >= ?');
      params.push(filters.since);
    }
    if (filters.until) {
      where.push('r.regressedAtCreatedAt < ?');
      params.push(filters.until);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM regressions r ${whereSql}`)
      .get(...params) as { n: number };

    const sortSql = (() => {
      switch (filters.sort) {
        case 'recent':
          return 'ORDER BY r.regressedAtCreatedAt DESC';
        case 'oldest':
          return 'ORDER BY r.regressedAtCreatedAt ASC';
        default:
          return `ORDER BY (
            r.failureCount *
            COALESCE(
              r.daysOpen,
              (julianday('now') - julianday(r.regressedAtCreatedAt))
            )
          ) DESC`;
      }
    })();

    const limit = Math.min(filters.limit ?? 25, 200);
    const offset = filters.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT r.*, t.title, t.filePath,
                rep.displayNumber AS regressedDisplayNumber,
                green.displayNumber AS lastGreenDisplayNumber
         FROM regressions r
         LEFT JOIN tests t USING (testId, fileId, project)
         LEFT JOIN reports rep ON rep.reportID = r.regressedAtReportId
         LEFT JOIN reports green ON green.reportID = r.lastGreenReportId
         ${whereSql}
         ${sortSql}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as RegressionListItem[];

    return { data: rows, total: totalRow.n };
  }

  public aggregateForAnalytics(opts: { project?: string; since?: string; until?: string }): {
    active: number;
    newInWindow: number;
    resolvedInWindow: number;
    medianMttrDays: number | null;
    topFiles: Array<{ filePath: string; count: number }>;
    topCommits: Array<{ commit: string; count: number }>;
  } {
    const projectClause = opts.project ? 'AND r.project = ?' : '';
    const projectParam = opts.project ? [opts.project] : [];
    const sinceClause = opts.since ? 'AND r.regressedAtCreatedAt >= ?' : '';
    const sinceParam = opts.since ? [opts.since] : [];
    const untilClause = opts.until ? 'AND r.regressedAtCreatedAt < ?' : '';
    const untilParam = opts.until ? [opts.until] : [];

    const ACTIVE_FALLBACK_DAYS = 14;
    const anchorMs = opts.until ? new Date(opts.until).getTime() : Date.now();
    const activeRunSince =
      opts.since ?? new Date(anchorMs - ACTIVE_FALLBACK_DAYS * 86_400_000).toISOString();
    const activeRunUntilClause = opts.until ? 'AND tr.createdAt < ?' : '';
    const activeRunUntilParam = opts.until ? [opts.until] : [];
    const active = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM regressions r
           JOIN tests t ON t.testId = r.testId
                       AND t.fileId = r.fileId
                       AND t.project = r.project
           WHERE r.recoveredAtReportId IS NULL
             ${projectClause}
             AND COALESCE(t.quarantined, 0) = 0
             AND COALESCE(t.latestOutcome, '') != 'skipped'
             AND EXISTS (
               SELECT 1 FROM test_runs tr
               WHERE tr.testId = r.testId
                 AND tr.fileId = r.fileId
                 AND tr.project = r.project
                 AND tr.createdAt >= ?
                 ${activeRunUntilClause}
             )`
        )
        .get(...projectParam, activeRunSince, ...activeRunUntilParam) as { n: number }
    ).n;

    const newInWindow = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM regressions r
           WHERE 1=1 ${projectClause} ${sinceClause} ${untilClause}`
        )
        .get(...projectParam, ...sinceParam, ...untilParam) as { n: number }
    ).n;

    const resolvedInWindow = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM regressions r
           WHERE r.recoveredAtReportId IS NOT NULL
             ${projectClause}
             ${opts.since ? 'AND r.recoveredAtCreatedAt >= ?' : ''}
             ${opts.until ? 'AND r.recoveredAtCreatedAt < ?' : ''}`
        )
        .get(...projectParam, ...sinceParam, ...untilParam) as { n: number }
    ).n;

    const mttrFilters: string[] = ['r.daysOpen IS NOT NULL'];
    const mttrParams: Array<string | number> = [];
    if (opts.project) {
      mttrFilters.push('r.project = ?');
      mttrParams.push(opts.project);
    }
    if (opts.since) {
      mttrFilters.push('r.recoveredAtCreatedAt >= ?');
      mttrParams.push(opts.since);
    }
    const mttrWhere = `WHERE ${mttrFilters.join(' AND ')}`;
    const mttrCount = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM regressions r ${mttrWhere}`)
        .get(...mttrParams) as { n: number }
    ).n;
    let medianMttrDays: number | null = null;
    if (mttrCount > 0) {
      const isEven = mttrCount % 2 === 0;
      const offset = isEven ? mttrCount / 2 - 1 : Math.floor(mttrCount / 2);
      const limit = isEven ? 2 : 1;
      const midRows = this.db
        .prepare(
          `SELECT daysOpen FROM regressions r ${mttrWhere}
           ORDER BY daysOpen ASC LIMIT ? OFFSET ?`
        )
        .all(...mttrParams, limit, offset) as Array<{ daysOpen: number }>;
      medianMttrDays = isEven
        ? (midRows[0].daysOpen + midRows[1].daysOpen) / 2
        : midRows[0].daysOpen;
    }

    const topFiles = this.db
      .prepare(
        `SELECT t.filePath, COUNT(*) AS count
         FROM regressions r
         JOIN tests t USING (testId, fileId, project)
         WHERE 1=1 ${projectClause} ${sinceClause}
         GROUP BY t.filePath
         ORDER BY count DESC LIMIT 5`
      )
      .all(...projectParam, ...sinceParam) as Array<{ filePath: string; count: number }>;

    const topCommitsRaw = this.db
      .prepare(
        `SELECT r.regressedAtCommit AS commitHash, COUNT(*) AS count
         FROM regressions r
         WHERE r.regressedAtCommit IS NOT NULL
           ${projectClause} ${sinceClause}
         GROUP BY r.regressedAtCommit
         ORDER BY count DESC LIMIT 5`
      )
      .all(...projectParam, ...sinceParam) as Array<{ commitHash: string; count: number }>;
    const topCommits = topCommitsRaw.map((r) => ({ commit: r.commitHash, count: r.count }));

    return { active, newInWindow, resolvedInWindow, medianMttrDays, topFiles, topCommits };
  }

  public closeOpenForTest(input: {
    testId: string;
    fileId: string;
    project: string;
    recoveredAtReportId: string;
    recoveredAtCreatedAt: string;
    recoveredAtCommit: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE regressions
         SET recoveredAtReportId = ?,
             recoveredAtCreatedAt = ?,
             recoveredAtCommit = ?,
             daysOpen = (julianday(?) - julianday(regressedAtCreatedAt))
         WHERE testId = ? AND fileId = ? AND project = ?
           AND recoveredAtReportId IS NULL`
      )
      .run(
        input.recoveredAtReportId,
        input.recoveredAtCreatedAt,
        input.recoveredAtCommit,
        input.recoveredAtCreatedAt,
        input.testId,
        input.fileId,
        input.project
      );
  }

  public hasOpenForTest(testId: string, fileId: string, project: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS x FROM regressions
         WHERE testId = ? AND fileId = ? AND project = ?
           AND recoveredAtReportId IS NULL
         LIMIT 1`
      )
      .get(testId, fileId, project) as { x: number } | undefined;
    return !!row;
  }

  // Batched existence check used by cluster lifecycle classification to
  // distinguish 'resolved' (had a regression that closed) from 'unattributed'
  // (never opened one).
  public hasAnyForTests(
    keys: Array<{ testId: string; fileId: string; project: string }>
  ): Set<string> {
    const out = new Set<string>();
    if (keys.length === 0) return out;
    const BATCH = 200;
    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      const valuesRows = slice.map(() => '(?, ?, ?)').join(',');
      const params: string[] = [];
      for (const k of slice) params.push(k.testId, k.fileId, k.project);
      const rows = this.db
        .prepare(
          `WITH keys(testId, fileId, project) AS (VALUES ${valuesRows})
           SELECT DISTINCT k.testId, k.fileId, k.project
           FROM keys k
           JOIN regressions r
             ON r.testId = k.testId AND r.fileId = k.fileId AND r.project = k.project`
        )
        .all(...params) as Array<{ testId: string; fileId: string; project: string }>;
      for (const row of rows) {
        // Mirror the `testKey` shape used by callers (project::fileId::testId).
        out.add(`${row.project}::${row.fileId}::${row.testId}`);
      }
    }
    return out;
  }

  public countsBetween(args: { project?: string; since: string; until: string }): {
    opened: number;
    resolved: number;
  } {
    const projectClause = args.project ? 'AND project = ?' : '';
    const projectParam = args.project ? [args.project] : [];
    const opened = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM regressions
           WHERE regressedAtCreatedAt > ? AND regressedAtCreatedAt <= ? ${projectClause}`
        )
        .get(args.since, args.until, ...projectParam) as { n: number }
    ).n;
    const resolved = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM regressions
           WHERE recoveredAtCreatedAt IS NOT NULL
             AND recoveredAtCreatedAt > ? AND recoveredAtCreatedAt <= ? ${projectClause}`
        )
        .get(args.since, args.until, ...projectParam) as { n: number }
    ).n;
    return { opened, resolved };
  }

  public countsForReport(reportId: string): { newHere: number; resolvedHere: number } {
    const opened = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM regressions WHERE regressedAtReportId = ?`)
        .get(reportId) as { n: number }
    ).n;
    const closed = (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM regressions WHERE recoveredAtReportId = ?`)
        .get(reportId) as { n: number }
    ).n;
    return { newHere: opened, resolvedHere: closed };
  }

  public getRegressionHighlightsForTests(
    keys: Array<{ testId: string; fileId: string; project: string }>,
    since?: string,
    until?: string
  ): Map<string, { newAtReportId?: string; resolvedAtReportId?: string }> {
    const out = new Map<string, { newAtReportId?: string; resolvedAtReportId?: string }>();
    if (keys.length === 0) return out;
    const BATCH = 200;
    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      const valuesRows = slice.map(() => '(?, ?, ?)').join(',');
      const params: Array<string | number> = [];
      for (const k of slice) params.push(k.testId, k.fileId, k.project);
      const windowClauses: string[] = [];
      if (since) {
        windowClauses.push(
          '(r.regressedAtCreatedAt >= ? OR (r.recoveredAtCreatedAt IS NOT NULL AND r.recoveredAtCreatedAt >= ?))'
        );
        params.push(since, since);
      }
      if (until) {
        windowClauses.push(
          '(r.regressedAtCreatedAt < ? OR (r.recoveredAtCreatedAt IS NOT NULL AND r.recoveredAtCreatedAt < ?))'
        );
        params.push(until, until);
      }
      const windowSql = windowClauses.length > 0 ? `WHERE ${windowClauses.join(' AND ')}` : '';
      const rows = this.db
        .prepare(
          `WITH keys(testId, fileId, project) AS (VALUES ${valuesRows})
           SELECT r.testId, r.fileId, r.project,
                  r.regressedAtReportId, r.recoveredAtReportId,
                  COALESCE(r.recoveredAtCreatedAt, r.regressedAtCreatedAt) AS eventAt
           FROM keys k
           JOIN regressions r
             ON r.testId = k.testId AND r.fileId = k.fileId AND r.project = k.project
           ${windowSql}
           ORDER BY eventAt DESC`
        )
        .all(...params) as Array<{
        testId: string;
        fileId: string;
        project: string;
        regressedAtReportId: string;
        recoveredAtReportId: string | null;
      }>;
      for (const row of rows) {
        const key = `${row.testId}::${row.fileId}::${row.project}`;
        if (out.has(key)) continue;
        const entry: { newAtReportId?: string; resolvedAtReportId?: string } = {
          newAtReportId: row.regressedAtReportId,
        };
        if (row.recoveredAtReportId) entry.resolvedAtReportId = row.recoveredAtReportId;
        out.set(key, entry);
      }
    }
    return out;
  }

  public countsForReports(
    reportIds: string[]
  ): Map<string, { newHere: number; resolvedHere: number }> {
    const out = new Map<string, { newHere: number; resolvedHere: number }>();
    if (reportIds.length === 0) return out;
    for (const id of reportIds) out.set(id, { newHere: 0, resolvedHere: 0 });
    const BATCH = 200;
    for (let i = 0; i < reportIds.length; i += BATCH) {
      const slice = reportIds.slice(i, i + BATCH);
      const placeholders = slice.map(() => '?').join(',');
      const openedRows = this.db
        .prepare(
          `SELECT regressedAtReportId AS id, COUNT(*) AS n
           FROM regressions
           WHERE regressedAtReportId IN (${placeholders})
           GROUP BY regressedAtReportId`
        )
        .all(...slice) as Array<{ id: string; n: number }>;
      for (const r of openedRows) {
        const entry = out.get(r.id);
        if (entry) entry.newHere = r.n;
      }
      const closedRows = this.db
        .prepare(
          `SELECT recoveredAtReportId AS id, COUNT(*) AS n
           FROM regressions
           WHERE recoveredAtReportId IN (${placeholders})
           GROUP BY recoveredAtReportId`
        )
        .all(...slice) as Array<{ id: string; n: number }>;
      for (const r of closedRows) {
        const entry = out.get(r.id);
        if (entry) entry.resolvedHere = r.n;
      }
    }
    return out;
  }

  public detailsForReports(
    reportIds: string[],
    perSideLimit = 10
  ): Map<
    string,
    {
      newHere: Array<{
        testId: string;
        fileId: string;
        project: string;
        title: string;
        filePath: string;
      }>;
      resolvedHere: Array<{
        testId: string;
        fileId: string;
        project: string;
        title: string;
        filePath: string;
      }>;
    }
  > {
    const out = new Map<
      string,
      {
        newHere: Array<{
          testId: string;
          fileId: string;
          project: string;
          title: string;
          filePath: string;
        }>;
        resolvedHere: Array<{
          testId: string;
          fileId: string;
          project: string;
          title: string;
          filePath: string;
        }>;
      }
    >();
    if (reportIds.length === 0) return out;
    for (const id of reportIds) out.set(id, { newHere: [], resolvedHere: [] });
    const BATCH = 200;
    type Row = {
      id: string;
      testId: string;
      fileId: string;
      project: string;
      title: string;
      filePath: string;
      rn: number;
    };
    for (let i = 0; i < reportIds.length; i += BATCH) {
      const slice = reportIds.slice(i, i + BATCH);
      const placeholders = slice.map(() => '?').join(',');
      const opened = this.db
        .prepare(
          `WITH ranked AS (
             SELECT r.regressedAtReportId AS id,
                    r.testId, r.fileId, r.project,
                    t.title, t.filePath,
                    ROW_NUMBER() OVER (
                      PARTITION BY r.regressedAtReportId
                      ORDER BY r.regressedAtCreatedAt DESC
                    ) AS rn
             FROM regressions r
             JOIN tests t USING (testId, fileId, project)
             WHERE r.regressedAtReportId IN (${placeholders})
           )
           SELECT id, testId, fileId, project, title, filePath, rn
           FROM ranked WHERE rn <= ?`
        )
        .all(...slice, perSideLimit) as Row[];
      for (const r of opened) {
        const entry = out.get(r.id);
        if (entry)
          entry.newHere.push({
            testId: r.testId,
            fileId: r.fileId,
            project: r.project,
            title: r.title,
            filePath: r.filePath,
          });
      }
      const resolved = this.db
        .prepare(
          `WITH ranked AS (
             SELECT r.recoveredAtReportId AS id,
                    r.testId, r.fileId, r.project,
                    t.title, t.filePath,
                    ROW_NUMBER() OVER (
                      PARTITION BY r.recoveredAtReportId
                      ORDER BY r.recoveredAtCreatedAt DESC
                    ) AS rn
             FROM regressions r
             JOIN tests t USING (testId, fileId, project)
             WHERE r.recoveredAtReportId IN (${placeholders})
           )
           SELECT id, testId, fileId, project, title, filePath, rn
           FROM ranked WHERE rn <= ?`
        )
        .all(...slice, perSideLimit) as Row[];
      for (const r of resolved) {
        const entry = out.get(r.id);
        if (entry)
          entry.resolvedHere.push({
            testId: r.testId,
            fileId: r.fileId,
            project: r.project,
            title: r.title,
            filePath: r.filePath,
          });
      }
    }
    return out;
  }

  public detectForReport(reportId: string, currentCommit: string | null): void {
    const reportRow = this.db
      .prepare(`SELECT createdAt FROM reports WHERE reportID = ?`)
      .get(reportId) as { createdAt: string } | undefined;
    if (!reportRow) return;

    type LaneRow = {
      testId: string;
      fileId: string;
      project: string;
      thisOutcome: string;
      thisCreatedAt: string;
      thisFailureCategory: string | null;
      thisSignature: string | null;
      // JSON {reportId, createdAt, commit} of the most recent prior green run
      lastGreen: string | null;
      openRegressionId: string | null;
      mostRecentClosedRegressionId: string | null;
      mostRecentClosedSignature: string | null;
    };
    const lanes = this.db
      .prepare(
        `WITH report_runs AS (
           SELECT testId, fileId, project, outcome, createdAt, failure_category, error_signature
           FROM test_runs WHERE reportId = ?
         )
         SELECT
           rr.testId, rr.fileId, rr.project,
           rr.outcome  AS thisOutcome,
           rr.createdAt AS thisCreatedAt,
           rr.failure_category AS thisFailureCategory,
           rr.error_signature AS thisSignature,
           (SELECT json_object(
              'reportId', t.reportId,
              'createdAt', t.createdAt,
              'commit', json_extract(rep.metadata, '$.gitCommit.hash')
            )
            FROM test_runs t
            LEFT JOIN reports rep ON rep.reportID = t.reportId
            WHERE t.testId = rr.testId AND t.fileId = rr.fileId AND t.project = rr.project
              AND t.createdAt < rr.createdAt
              AND t.outcome IN ('passed','expected')
            ORDER BY t.createdAt DESC LIMIT 1) AS lastGreen,
           (SELECT id FROM regressions reg
            WHERE reg.testId = rr.testId AND reg.fileId = rr.fileId AND reg.project = rr.project
              AND reg.recoveredAtReportId IS NULL
            LIMIT 1) AS openRegressionId,
           (SELECT id FROM regressions reg
            WHERE reg.testId = rr.testId AND reg.fileId = rr.fileId AND reg.project = rr.project
              AND reg.recoveredAtReportId IS NOT NULL
            ORDER BY reg.recoveredAtCreatedAt DESC LIMIT 1) AS mostRecentClosedRegressionId,
           (SELECT tr2.error_signature FROM regressions reg
            JOIN test_runs tr2
              ON tr2.testId = reg.testId AND tr2.fileId = reg.fileId AND tr2.project = reg.project
              AND tr2.reportId = reg.regressedAtReportId
            WHERE reg.testId = rr.testId AND reg.fileId = rr.fileId AND reg.project = rr.project
              AND reg.recoveredAtReportId IS NOT NULL
            ORDER BY reg.recoveredAtCreatedAt DESC LIMIT 1) AS mostRecentClosedSignature
         FROM report_runs rr`
      )
      .all(reportId) as LaneRow[];
    if (lanes.length === 0) return;

    const closeStmt = this.db.prepare(
      `UPDATE regressions
       SET recoveredAtReportId = ?, recoveredAtCreatedAt = ?, recoveredAtCommit = ?,
           daysOpen = julianday(?) - julianday(regressedAtCreatedAt)
       WHERE id = ?`
    );
    const bumpFailureStmt = this.db.prepare(
      `UPDATE regressions SET failureCount = failureCount + 1 WHERE id = ?`
    );
    const reopenStmt = this.db.prepare(
      `UPDATE regressions
       SET recoveredAtReportId = NULL,
           recoveredAtCreatedAt = NULL,
           recoveredAtCommit = NULL,
           daysOpen = NULL
       WHERE id = ?`
    );
    const bumpFlakyStmt = this.db.prepare(
      `UPDATE regressions SET flakyCount = flakyCount + 1 WHERE id = ?`
    );
    const openStmt = this.db.prepare(
      `INSERT INTO regressions (
         id, testId, fileId, project,
         regressedAtReportId, regressedAtCreatedAt, regressedAtCommit, regressedAtCategory,
         lastGreenReportId, lastGreenCreatedAt, lastGreenCommit,
         failureCount, flakyCount
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,0)`
    );

    for (const lane of lanes) {
      const o = lane.thisOutcome;
      const isGreen = o === 'passed' || o === 'expected';
      const isSkipped = o === 'skipped';
      const isFlaky = o === 'flaky';
      const isFailed = o === 'failed' || o === 'unexpected';

      if (isSkipped) {
        if (lane.openRegressionId) {
          closeStmt.run(
            reportId,
            lane.thisCreatedAt,
            null,
            lane.thisCreatedAt,
            lane.openRegressionId
          );
        }
        continue;
      }
      if (isGreen) {
        if (lane.openRegressionId) {
          closeStmt.run(
            reportId,
            lane.thisCreatedAt,
            currentCommit,
            lane.thisCreatedAt,
            lane.openRegressionId
          );
        }
        continue;
      }
      if (isFlaky) {
        if (lane.openRegressionId) bumpFlakyStmt.run(lane.openRegressionId);
        continue;
      }
      if (!isFailed) continue;

      if (lane.openRegressionId) {
        bumpFailureStmt.run(lane.openRegressionId);
        continue;
      }
      const sameSignature =
        lane.thisSignature &&
        lane.mostRecentClosedSignature &&
        lane.thisSignature === lane.mostRecentClosedSignature;
      if (lane.mostRecentClosedRegressionId && sameSignature) {
        reopenStmt.run(lane.mostRecentClosedRegressionId);
        bumpFailureStmt.run(lane.mostRecentClosedRegressionId);
        continue;
      }
      const lastGreen = lane.lastGreen
        ? (JSON.parse(lane.lastGreen) as {
            reportId: string | null;
            createdAt: string | null;
            commit: string | null;
          })
        : null;
      if (!lastGreen?.reportId) continue;
      openStmt.run(
        randomUUID(),
        lane.testId,
        lane.fileId,
        lane.project,
        reportId,
        lane.thisCreatedAt,
        currentCommit,
        lane.thisFailureCategory,
        lastGreen.reportId,
        lastGreen.createdAt,
        lastGreen.commit
      );
    }
  }
}

export const regressionsDb = singletonOf('regressions', () => new RegressionsDatabase());
