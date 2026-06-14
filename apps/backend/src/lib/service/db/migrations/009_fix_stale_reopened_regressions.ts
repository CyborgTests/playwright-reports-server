import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * Before the signature-based reopen guard, detectForReport() would reopen
 * the most-recent closed regression whenever a test failed again — even if
 * the new failure had a completely different error signature. This left
 * regressions with regressedAtCreatedAt pointing far in the past while the
 * real failure streak started much later.
 *
 * This migration finds those stale reopened regressions, closes them at the
 * last green run, and opens fresh regressions with the correct start date.
 */
export const migration009FixStaleReopenedRegressions: Migration = {
  id: '009_fix_stale_reopened_regressions',
  description: 'Close incorrectly-reopened regressions and open fresh ones with correct timestamps',
  up: (db: Database.Database) => {
    const staleRows = db
      .prepare(
        `SELECT
           reg.id,
           reg.testId,
           reg.fileId,
           reg.project,
           reg.regressedAtCreatedAt,
           origRun.error_signature AS originalSignature,
           latestFail.error_signature AS currentSignature
         FROM regressions reg
         JOIN test_runs origRun
           ON origRun.testId = reg.testId
           AND origRun.fileId = reg.fileId
           AND origRun.project = reg.project
           AND origRun.reportId = reg.regressedAtReportId
           AND origRun.outcome IN ('failed', 'unexpected')
         JOIN test_runs latestFail
           ON latestFail.rowid = (
             SELECT tr.rowid FROM test_runs tr
             WHERE tr.testId = reg.testId
               AND tr.fileId = reg.fileId
               AND tr.project = reg.project
               AND tr.outcome IN ('failed', 'unexpected')
             ORDER BY tr.createdAt DESC LIMIT 1
           )
         WHERE reg.recoveredAtReportId IS NULL
           AND origRun.error_signature IS NOT NULL
           AND latestFail.error_signature IS NOT NULL
           AND origRun.error_signature != latestFail.error_signature`
      )
      .all() as Array<{
      id: string;
      testId: string;
      fileId: string;
      project: string;
      regressedAtCreatedAt: string;
      originalSignature: string;
      currentSignature: string;
    }>;

    if (staleRows.length === 0) {
      console.log('[fix_stale_reopened] no stale reopened regressions found');
      return;
    }

    console.log(`[fix_stale_reopened] found ${staleRows.length} stale reopened regression(s)`);

    const findLastGreenAfterRegression = db.prepare(
      `SELECT tr.reportId, tr.createdAt,
              json_extract(r.metadata, '$.gitCommit.hash') AS commitHash
       FROM test_runs tr
       LEFT JOIN reports r ON r.reportID = tr.reportId
       WHERE tr.testId = ? AND tr.fileId = ? AND tr.project = ?
         AND tr.outcome IN ('passed', 'expected')
         AND tr.createdAt > ?
       ORDER BY tr.createdAt DESC LIMIT 1`
    );

    const findFirstFailAfterGreen = db.prepare(
      `SELECT tr.reportId, tr.createdAt, tr.failure_category,
              json_extract(r.metadata, '$.gitCommit.hash') AS commitHash
       FROM test_runs tr
       LEFT JOIN reports r ON r.reportID = tr.reportId
       WHERE tr.testId = ? AND tr.fileId = ? AND tr.project = ?
         AND tr.createdAt > ?
         AND tr.outcome IN ('failed', 'unexpected')
       ORDER BY tr.createdAt ASC LIMIT 1`
    );

    const countFailsAfterGreen = db.prepare(
      `SELECT COUNT(*) AS cnt FROM test_runs
       WHERE testId = ? AND fileId = ? AND project = ?
         AND createdAt > ?
         AND outcome IN ('failed', 'unexpected')`
    );

    const countFlakysAfterGreen = db.prepare(
      `SELECT COUNT(*) AS cnt FROM test_runs
       WHERE testId = ? AND fileId = ? AND project = ?
         AND createdAt > ?
         AND outcome = 'flaky'`
    );

    const closeStmt = db.prepare(
      `UPDATE regressions
       SET recoveredAtReportId = ?,
           recoveredAtCreatedAt = ?,
           recoveredAtCommit = ?,
           daysOpen = julianday(?) - julianday(regressedAtCreatedAt)
       WHERE id = ?`
    );

    const insertStmt = db.prepare(
      `INSERT INTO regressions (
         id, testId, fileId, project,
         regressedAtReportId, regressedAtCreatedAt, regressedAtCommit, regressedAtCategory,
         lastGreenReportId, lastGreenCreatedAt, lastGreenCommit,
         failureCount, flakyCount
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    let closed = 0;
    let opened = 0;

    for (const row of staleRows) {
      const lastGreen = findLastGreenAfterRegression.get(
        row.testId,
        row.fileId,
        row.project,
        row.regressedAtCreatedAt
      ) as { reportId: string; createdAt: string; commitHash: string | null } | undefined;

      if (!lastGreen) {
        console.log(
          `[fix_stale_reopened] skipping ${row.id}: no green run after original regression`
        );
        continue;
      }

      closeStmt.run(
        lastGreen.reportId,
        lastGreen.createdAt,
        lastGreen.commitHash,
        lastGreen.createdAt,
        row.id
      );
      closed++;

      const firstFail = findFirstFailAfterGreen.get(
        row.testId,
        row.fileId,
        row.project,
        lastGreen.createdAt
      ) as
        | {
            reportId: string;
            createdAt: string;
            failure_category: string | null;
            commitHash: string | null;
          }
        | undefined;

      if (!firstFail) continue;

      const failCount = (
        countFailsAfterGreen.get(row.testId, row.fileId, row.project, lastGreen.createdAt) as {
          cnt: number;
        }
      ).cnt;

      const flakyCount = (
        countFlakysAfterGreen.get(row.testId, row.fileId, row.project, lastGreen.createdAt) as {
          cnt: number;
        }
      ).cnt;

      insertStmt.run(
        randomUUID(),
        row.testId,
        row.fileId,
        row.project,
        firstFail.reportId,
        firstFail.createdAt,
        firstFail.commitHash,
        firstFail.failure_category,
        lastGreen.reportId,
        lastGreen.createdAt,
        lastGreen.commitHash,
        failCount,
        flakyCount
      );
      opened++;
    }

    console.log(
      `[fix_stale_reopened] done: closed ${closed} stale regression(s), opened ${opened} new one(s)`
    );
  },
};
