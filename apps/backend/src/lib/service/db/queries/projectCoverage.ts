import type { ProjectCoverageScope } from '../../../llm/prompts/index.js';
import { getDatabase } from '../db.js';

export function computeProjectCoverageScope(
  reportIds: string[],
  priorReportIds: string[] | null,
  windowStartIso: string,
  windowEndIso: string,
  project: string
): ProjectCoverageScope | undefined {
  if (reportIds.length === 0) return undefined;
  const db = getDatabase();
  const projectFilter = project === 'all' ? '' : ' AND project = ?';
  const projectParams = project === 'all' ? [] : [project];

  const totalTests = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM tests WHERE 1=1${projectFilter}`)
      .get(...projectParams) as { c: number }
  ).c;

  const testsAddedInWindow = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM tests WHERE createdAt >= ? AND createdAt <= ?${projectFilter}`
      )
      .get(windowStartIso, windowEndIso, ...projectParams) as { c: number }
  ).c;

  const currentlyQuarantined = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT testId, fileId, project, MAX(createdAt) AS latest_at
           FROM test_runs
           WHERE 1=1${projectFilter}
           GROUP BY testId, fileId, project
         ) latest
         JOIN test_runs tr
           ON tr.testId = latest.testId
           AND tr.fileId = latest.fileId
           AND tr.project = latest.project
           AND tr.createdAt = latest.latest_at
         WHERE tr.quarantined = 1`
      )
      .get(...projectParams) as { c: number }
  ).c;

  const reportIdsPlaceholders = reportIds.map(() => '?').join(',');
  const quarantineFailuresInWindow = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM test_runs
         WHERE quarantined = 1
           AND outcome IN ('unexpected', 'flaky', 'failed')
           AND reportId IN (${reportIdsPlaceholders})`
      )
      .get(...reportIds) as { c: number }
  ).c;

  const windowDistinctTests = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT testId || '::' || fileId || '::' || project) AS c
         FROM test_runs WHERE reportId IN (${reportIdsPlaceholders})`
      )
      .get(...reportIds) as { c: number }
  ).c;

  let priorDistinctTests: number | undefined;
  if (priorReportIds && priorReportIds.length > 0) {
    const priorPlaceholders = priorReportIds.map(() => '?').join(',');
    priorDistinctTests = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT testId || '::' || fileId || '::' || project) AS c
           FROM test_runs WHERE reportId IN (${priorPlaceholders})`
        )
        .get(...priorReportIds) as { c: number }
    ).c;
  }

  type NearFlakeRow = {
    testId: string;
    fileId: string;
    title: string | null;
    filePath: string | null;
    c: number;
  };
  const nearFlakeRows = db
    .prepare(
      `SELECT tr.testId AS testId, tr.fileId AS fileId,
              t.title AS title, t.filePath AS filePath,
              COUNT(*) AS c
       FROM test_runs tr
       LEFT JOIN tests t
         ON t.testId = tr.testId AND t.fileId = tr.fileId AND t.project = tr.project
       WHERE tr.outcome = 'flaky'
         AND tr.reportId IN (${reportIdsPlaceholders})
       GROUP BY tr.testId, tr.fileId, tr.project
       ORDER BY c DESC, tr.testId
       LIMIT 5`
    )
    .all(...reportIds) as NearFlakeRow[];
  const nearFlakes = nearFlakeRows.map((row) => ({
    testId: row.testId,
    fileId: row.fileId,
    title: row.title ?? row.testId,
    filePath: row.filePath ?? row.fileId,
    flakyOccurrences: row.c,
  }));

  return {
    totalTests,
    testsAddedInWindow,
    currentlyQuarantined,
    quarantineFailuresInWindow,
    windowDistinctTests,
    priorDistinctTests,
    nearFlakes,
  };
}
