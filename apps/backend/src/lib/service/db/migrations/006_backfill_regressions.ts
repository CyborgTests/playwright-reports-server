import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

// Backfill the `regressions` table from existing `test_runs` history.
export const migration006BackfillRegressions: Migration = {
  id: '006_backfill_regressions',
  description: 'Backfill regressions from historical test_runs',
  up: (db: Database.Database) => {
    const existing = db.prepare('SELECT COUNT(*) AS n FROM regressions').get() as { n: number };
    if (existing.n > 0) {
      console.log(`[backfill_regressions] skipping: table already has ${existing.n} rows`);
      return;
    }

    const rows = db
      .prepare(
        `SELECT tr.testId, tr.fileId, tr.project, tr.reportId, tr.createdAt,
                tr.outcome, tr.failure_category AS failureCategory,
                json_extract(r.metadata, '$.gitCommit.hash') AS commitHash
         FROM test_runs tr
         LEFT JOIN reports r ON r.reportID = tr.reportId
         ORDER BY tr.testId, tr.fileId, tr.project, tr.createdAt, tr.runId`
      )
      .all() as Array<{
      testId: string;
      fileId: string;
      project: string;
      reportId: string;
      createdAt: string;
      outcome: string;
      failureCategory: string | null;
      commitHash: string | null;
    }>;

    if (rows.length === 0) {
      console.log('[backfill_regressions] no test_runs to scan; done');
      return;
    }

    interface OpenState {
      id: string;
      regressedAtCreatedAt: string;
      failureCount: number;
      flakyCount: number;
    }
    interface BackfillRow {
      id: string;
      testId: string;
      fileId: string;
      project: string;
      regressedAtReportId: string;
      regressedAtCreatedAt: string;
      regressedAtCommit: string | null;
      regressedAtCategory: string | null;
      lastGreenReportId: string | null;
      lastGreenCreatedAt: string | null;
      lastGreenCommit: string | null;
      recoveredAtReportId: string | null;
      recoveredAtCreatedAt: string | null;
      recoveredAtCommit: string | null;
      daysOpen: number | null;
      failureCount: number;
      flakyCount: number;
    }

    const toInsert: BackfillRow[] = [];
    let currentKey: string | null = null;
    let lastGreen: { reportId: string; createdAt: string; commit: string | null } | null = null;
    let open: OpenState | null = null;

    for (const row of rows) {
      const key = `${row.testId}::${row.fileId}::${row.project}`;
      if (key !== currentKey) {
        lastGreen = null;
        open = null;
        currentKey = key;
      }

      const outcome = row.outcome;
      const isGreen = outcome === 'passed' || outcome === 'expected';
      const isFlaky = outcome === 'flaky';
      const isFailed = outcome === 'failed' || outcome === 'unexpected';

      if (isGreen) {
        if (open) {
          const daysOpen =
            (Date.parse(row.createdAt) - Date.parse(open.regressedAtCreatedAt)) / 86_400_000;
          const inserted = toInsert.find((r) => r.id === open?.id);
          if (inserted) {
            inserted.recoveredAtReportId = row.reportId;
            inserted.recoveredAtCreatedAt = row.createdAt;
            inserted.recoveredAtCommit = row.commitHash;
            inserted.daysOpen = daysOpen;
            inserted.failureCount = open.failureCount;
            inserted.flakyCount = open.flakyCount;
          }
          open = null;
        }
        lastGreen = { reportId: row.reportId, createdAt: row.createdAt, commit: row.commitHash };
      } else if (isFailed) {
        if (open) {
          open.failureCount += 1;
        } else if (lastGreen) {
          const id = randomUUID();
          open = {
            id,
            regressedAtCreatedAt: row.createdAt,
            failureCount: 1,
            flakyCount: 0,
          };
          toInsert.push({
            id,
            testId: row.testId,
            fileId: row.fileId,
            project: row.project,
            regressedAtReportId: row.reportId,
            regressedAtCreatedAt: row.createdAt,
            regressedAtCommit: row.commitHash,
            regressedAtCategory: row.failureCategory,
            lastGreenReportId: lastGreen.reportId,
            lastGreenCreatedAt: lastGreen.createdAt,
            lastGreenCommit: lastGreen.commit,
            recoveredAtReportId: null,
            recoveredAtCreatedAt: null,
            recoveredAtCommit: null,
            daysOpen: null,
            failureCount: 1,
            flakyCount: 0,
          });
        }
      } else if (isFlaky) {
        if (open) open.flakyCount += 1;
      }
      // skipped: no state change.
    }

    if (toInsert.length === 0) {
      console.log('[backfill_regressions] scanned but no transitions detected');
      return;
    }

    const stmt = db.prepare(
      `INSERT INTO regressions (
        id, testId, fileId, project,
        regressedAtReportId, regressedAtCreatedAt, regressedAtCommit, regressedAtCategory,
        lastGreenReportId, lastGreenCreatedAt, lastGreenCommit,
        recoveredAtReportId, recoveredAtCreatedAt, recoveredAtCommit,
        daysOpen, failureCount, flakyCount
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const tx = db.transaction((batch: BackfillRow[]) => {
      for (const r of batch) {
        stmt.run(
          r.id,
          r.testId,
          r.fileId,
          r.project,
          r.regressedAtReportId,
          r.regressedAtCreatedAt,
          r.regressedAtCommit,
          r.regressedAtCategory,
          r.lastGreenReportId,
          r.lastGreenCreatedAt,
          r.lastGreenCommit,
          r.recoveredAtReportId,
          r.recoveredAtCreatedAt,
          r.recoveredAtCommit,
          r.daysOpen,
          r.failureCount,
          r.flakyCount
        );
      }
    });
    tx(toInsert);

    const open_n = toInsert.filter((r) => r.recoveredAtReportId === null).length;
    const closed_n = toInsert.length - open_n;
    console.log(
      `[backfill_regressions] inserted ${toInsert.length} regressions (${open_n} open, ${closed_n} closed) from ${rows.length} test_runs`
    );
  },
};
