import type Database from 'better-sqlite3';
import {
  collectRunDeltas,
  deserializeDelta,
  type RunDeltaInput,
  type SerializedDelta,
  serializeDelta,
} from '../dailyTotals/deltas.js';
import {
  histogramAdd,
  histogramDecode,
  histogramEncode,
  histogramMerge,
  histogramPercentile,
  histogramSubtract,
  newHistogram,
} from '../dailyTotals/histogram.js';
import { resolveWindow, type WindowPart } from '../dailyTotals/windows.js';
import { getDatabase } from './db.js';
import { singletonOf } from './singleton.js';

export interface DurationAggregateResult {
  avgDuration: number;
  p95Duration: number;
  count: number;
}

export interface RollupDayTotals {
  runs: number;
  executed: number;
  passed: number;
  failed: number;
  flaky: number;
  sumDuration: number;
  durationCount: number;
}

export class DailyTotalsDatabase {
  private readonly db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  public applyReportRuns(reportId: string, project: string, runs: RunDeltaInput[]): void {
    if (runs.length === 0) return;
    const alreadyApplied = this.db
      .prepare('SELECT 1 AS present FROM daily_test_totals_sources WHERE reportId = ? LIMIT 1')
      .get(reportId) as { present: number } | undefined;
    if (alreadyApplied) return;

    const now = new Date().toISOString();
    const byDay = collectRunDeltas(runs);

    const upsert = this.db.prepare(`
      INSERT INTO daily_test_totals (
        project, day, runs, executed, passed, failed, flaky,
        sumDuration, durationCount, durationBuckets, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, day) DO UPDATE SET
        runs = runs + excluded.runs,
        executed = executed + excluded.executed,
        passed = passed + excluded.passed,
        failed = failed + excluded.failed,
        flaky = flaky + excluded.flaky,
        sumDuration = sumDuration + excluded.sumDuration,
        durationCount = durationCount + excluded.durationCount,
        durationBuckets = excluded.durationBuckets,
        updatedAt = excluded.updatedAt
    `);
    const insertSource = this.db.prepare(
      `INSERT INTO daily_test_totals_sources (reportId, project, day, deltas, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const [day, delta] of byDay) {
      const existing = this.db
        .prepare('SELECT durationBuckets FROM daily_test_totals WHERE project = ? AND day = ?')
        .get(project, day) as { durationBuckets: Buffer | null } | undefined;
      const buckets = existing
        ? histogramMerge(delta.buckets, histogramDecode(existing.durationBuckets))
        : delta.buckets;

      upsert.run(
        project,
        day,
        delta.runs,
        delta.executed,
        delta.passed,
        delta.failed,
        delta.flaky,
        delta.sumDuration,
        delta.durationCount,
        histogramEncode(buckets),
        now
      );
      insertSource.run(reportId, project, day, serializeDelta(delta), now);
    }
  }

  public reverseReport(reportId: string): Array<{ project: string; day: string }> {
    const sources = this.db
      .prepare('SELECT project, day, deltas FROM daily_test_totals_sources WHERE reportId = ?')
      .all(reportId) as Array<{ project: string; day: string; deltas: string }>;
    if (sources.length === 0) return [];

    const applyNegated = this.db.prepare(`
      UPDATE daily_test_totals SET
        runs = MAX(0, runs + ?),
        executed = MAX(0, executed + ?),
        passed = MAX(0, passed + ?),
        failed = MAX(0, failed + ?),
        flaky = MAX(0, flaky + ?),
        sumDuration = MAX(0, sumDuration + ?),
        durationCount = MAX(0, durationCount + ?),
        durationBuckets = ?,
        updatedAt = ?
      WHERE project = ? AND day = ?
    `);
    const dropSource = this.db.prepare(
      'DELETE FROM daily_test_totals_sources WHERE reportId = ? AND project = ? AND day = ?'
    );

    for (const source of sources) {
      const d = deserializeDelta(source.deltas);
      applyNegated.run(
        -d.runs,
        -d.executed,
        -d.passed,
        -d.failed,
        -d.flaky,
        -d.sumDuration,
        -d.durationCount,
        histogramEncode(
          histogramSubtract(
            this.readBuckets(source.project, source.day),
            histogramDecode(Buffer.from(d.buckets, 'base64'))
          )
        ),
        new Date().toISOString(),
        source.project,
        source.day
      );
      dropSource.run(reportId, source.project, source.day);
    }
    return sources.map((s) => ({ project: s.project, day: s.day }));
  }

  public moveReport(reportId: string, fromProject: string, toProject: string): void {
    if (fromProject === toProject) return;
    const sources = this.db
      .prepare(
        'SELECT day, deltas FROM daily_test_totals_sources WHERE reportId = ? AND project = ?'
      )
      .all(reportId, fromProject) as Array<{ day: string; deltas: string }>;
    if (sources.length === 0) return;

    const dropSource = this.db.prepare(
      'DELETE FROM daily_test_totals_sources WHERE reportId = ? AND project = ? AND day = ?'
    );
    const recordSource = this.db.prepare(
      'INSERT INTO daily_test_totals_sources (reportId, project, day, deltas, createdAt) VALUES (?, ?, ?, ?, ?)'
    );
    const now = new Date().toISOString();

    for (const source of sources) {
      const delta = deserializeDelta(source.deltas);
      this.applySerialized(fromProject, source.day, negateCounts(delta));
      this.applySerialized(toProject, source.day, delta);
      dropSource.run(reportId, fromProject, source.day);
      recordSource.run(reportId, toProject, source.day, source.deltas, now);
    }
  }

  public ensureBackfilled(): boolean {
    const marker = this.db
      .prepare("SELECT value FROM daily_totals_meta WHERE key = 'backfilled'")
      .get() as { value: string } | undefined;
    if (marker) return false;

    const reportIds = this.db
      .prepare('SELECT DISTINCT reportId FROM test_runs ORDER BY reportId')
      .all() as Array<{ reportId: string }>;
    const runsStmt = this.db.prepare(
      `SELECT project, outcome, duration, createdAt, testId, fileId
       FROM test_runs WHERE reportId = ?`
    );

    let processed = 0;
    const applyAll = this.db.transaction(() => {
      for (const { reportId } of reportIds) {
        const runs = runsStmt.all(reportId) as RunDeltaInput[];
        if (runs.length === 0 || runs[0] === undefined) continue;
        this.applyReportRuns(reportId, runs[0].project, runs);
        processed += runs.length;
      }
      this.db
        .prepare("INSERT INTO daily_totals_meta (key, value) VALUES ('backfilled', ?)")
        .run(new Date().toISOString());
    });
    applyAll();
    console.log(
      `[daily-dailyTotals] historical totals filled: ${reportIds.length} reports, ${processed} runs`
    );
    return true;
  }

  private dayFilterSql(
    project: string | undefined,
    part: WindowPart,
    column: string
  ): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (part.allBeforeDay !== undefined) {
      clauses.push(`${column} < ?`);
      params.push(part.allBeforeDay);
    }
    if (part.interiorDays.length > 0) {
      clauses.push(`${column} IN (${part.interiorDays.map(() => '?').join(', ')})`);
      params.push(...part.interiorDays);
    }
    if (project !== undefined) {
      clauses.push('project = ?');
      params.push(project);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  private totalsForWindow(
    project: string | undefined,
    part: WindowPart
  ): RollupDayTotals | undefined {
    const hasInterior = part.allBeforeDay !== undefined || part.interiorDays.length > 0;
    if (!hasInterior) return undefined;
    const { where, params } = this.dayFilterSql(project, part, 'day');
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(runs), 0) AS runs,
                COALESCE(SUM(executed), 0) AS executed,
                COALESCE(SUM(passed), 0) AS passed,
                COALESCE(SUM(failed), 0) AS failed,
                COALESCE(SUM(flaky), 0) AS flaky,
                COALESCE(SUM(sumDuration), 0) AS sumDuration,
                COALESCE(SUM(durationCount), 0) AS durationCount
         FROM daily_test_totals ${where}`
      )
      .get(...params) as RollupDayTotals;
  }

  private histogramForWindow(project: string | undefined, part: WindowPart) {
    const hasInterior = part.allBeforeDay !== undefined || part.interiorDays.length > 0;
    if (!hasInterior) return undefined;
    const { where, params } = this.dayFilterSql(project, part, 'day');
    const rows = this.db
      .prepare(
        `SELECT durationBuckets FROM daily_test_totals ${where}
           ${where ? 'AND' : 'WHERE'} durationBuckets IS NOT NULL`
      )
      .all(...params) as Array<{ durationBuckets: Buffer }>;
    let merged: ReturnType<typeof histogramDecode> | undefined;
    for (const row of rows) {
      merged = merged
        ? histogramMerge(merged, histogramDecode(row.durationBuckets))
        : histogramDecode(row.durationBuckets);
    }
    return merged;
  }

  public getDurationAggregates(
    project: string | undefined,
    from?: string,
    to?: string
  ): DurationAggregateResult {
    const window: WindowPart = resolveWindow(from, to);

    let sumDuration = 0;
    let count = 0;
    let merged: ReturnType<typeof histogramDecode> | undefined;

    const totals = this.totalsForWindow(project, window);
    if (totals) {
      sumDuration += totals.sumDuration;
      count += totals.durationCount;
      merged = this.histogramForWindow(project, window);
    }

    for (const edge of window.edgeRanges) {
      const durations = this.scanEdgeDurations(project, edge.fromIso, edge.toIsoExclusive);
      for (const duration of durations) {
        sumDuration += duration;
        count += 1;
      }
      if (durations.length > 0 && !merged) merged = newHistogram();
      if (merged) {
        for (const duration of durations) histogramAdd(merged, duration);
      }
    }

    if (count === 0) return { avgDuration: 0, p95Duration: 0, count: 0 };
    return {
      avgDuration: sumDuration / count,
      p95Duration: merged ? Math.round(histogramPercentile(merged, 0.95)) : 0,
      count,
    };
  }

  private scanEdgeDurations(
    project: string | undefined,
    fromIso: string,
    toIsoExclusive: string
  ): number[] {
    const conditions = [
      "outcome != 'skipped'",
      'duration IS NOT NULL',
      'createdAt >= ?',
      'createdAt < ?',
    ];
    const params: Array<string | number> = [fromIso, toIsoExclusive];
    if (project !== undefined) {
      conditions.unshift('project = ?');
      params.unshift(project);
    }
    const rows = this.db
      .prepare(`SELECT duration FROM test_runs WHERE ${conditions.join(' AND ')}`)
      .all(...params) as Array<{ duration: number }>;
    return rows.map((r) => r.duration);
  }

  private readBuckets(project: string, day: string) {
    const row = this.db
      .prepare('SELECT durationBuckets FROM daily_test_totals WHERE project = ? AND day = ?')
      .get(project, day) as { durationBuckets: Buffer | null } | undefined;
    return histogramDecode(row?.durationBuckets);
  }

  private applySerialized(project: string, day: string, d: SerializedDelta): void {
    const existing = this.readBuckets(project, day);
    this.db
      .prepare(
        `INSERT INTO daily_test_totals (
           project, day, runs, executed, passed, failed, flaky,
           sumDuration, durationCount, durationBuckets, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project, day) DO UPDATE SET
           runs = MAX(0, runs + excluded.runs),
           executed = MAX(0, executed + excluded.executed),
           passed = MAX(0, passed + excluded.passed),
           failed = MAX(0, failed + excluded.failed),
           flaky = MAX(0, flaky + excluded.flaky),
           sumDuration = MAX(0, sumDuration + excluded.sumDuration),
           durationCount = MAX(0, durationCount + excluded.durationCount),
           durationBuckets = excluded.durationBuckets,
           updatedAt = excluded.updatedAt`
      )
      .run(
        project,
        day,
        d.runs,
        d.executed,
        d.passed,
        d.failed,
        d.flaky,
        d.sumDuration,
        d.durationCount,
        histogramEncode(
          histogramMerge(histogramDecode(Buffer.from(d.buckets, 'base64')), existing)
        ),
        new Date().toISOString()
      );
  }
}

function negateCounts(d: SerializedDelta): SerializedDelta {
  return {
    ...d,
    runs: -d.runs,
    executed: -d.executed,
    passed: -d.passed,
    failed: -d.failed,
    flaky: -d.flaky,
    sumDuration: -d.sumDuration,
    durationCount: -d.durationCount,
  };
}

export const dailyTotalsDb = singletonOf('dailyTotals', () => new DailyTotalsDatabase());
