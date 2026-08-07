import type { ReportFile } from '@playwright-reports/shared';
import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';
import { normalizeAnnotations, normalizeStringArray } from '../tests/definition.js';

// `reports.files` has the whole test tree as JSON per report.
// 0005 drops the blob once this backfill has committed.
const MAX_UNMATCHED_FRACTION = 0.01;

export async function up(_db: Kysely<unknown>): Promise<void> {
  const db = getDatabase();

  const migrate = db.transaction(() => {
    db.exec(`
      ALTER TABLE tests ADD COLUMN projectName TEXT;
      ALTER TABLE tests ADD COLUMN suitePath TEXT;
      ALTER TABLE tests ADD COLUMN tags TEXT;
      ALTER TABLE test_runs ADD COLUMN annotations TEXT;
    `);

    const updateTest = db.prepare(
      `UPDATE tests
          SET projectName = ?, suitePath = ?, tags = ?
        WHERE testId = ? AND fileId = ? AND project = ?`
    );
    const updateRun = db.prepare(
      `UPDATE test_runs SET annotations = ?
        WHERE reportId = ? AND testId = ? AND fileId = ? AND project = ?`
    );

    let tests = 0;
    let unmatched = 0;

    const reportIds = db
      .prepare(
        `SELECT reportID, project FROM reports
         WHERE files IS NOT NULL
         ORDER BY createdAt ASC`
      )
      .all() as Array<{ reportID: string; project: string }>;
    const selectBlob = db.prepare('SELECT files FROM reports WHERE reportID = ?');

    for (const report of reportIds) {
      const blob = (selectBlob.get(report.reportID) as { files: string | null } | undefined)?.files;
      if (!blob) continue;
      let files: ReportFile[];
      try {
        files = JSON.parse(blob) as ReportFile[];
      } catch {
        continue;
      }
      if (!Array.isArray(files)) continue;

      for (const file of files) {
        const fileId = file.fileId ?? '';
        for (const test of file.tests ?? []) {
          const testId = test.testId ?? '';
          if (!testId || !fileId) continue;
          tests++;

          const result = updateTest.run(
            test.projectName ?? null,
            normalizeStringArray(test.path),
            normalizeStringArray(test.tags),
            testId,
            fileId,
            report.project
          );
          if (result.changes === 0) unmatched++;

          const annotations = normalizeAnnotations(test.annotations);
          if (annotations !== null) {
            updateRun.run(annotations, report.reportID, testId, fileId, report.project);
          }
        }
      }
    }

    if (tests > 0 && unmatched / tests > MAX_UNMATCHED_FRACTION) {
      throw new Error(
        `0004 backfill: ${unmatched} of ${tests} test entries had no matching tests row ` +
          `(over ${MAX_UNMATCHED_FRACTION * 100}%) - refusing to continue, 0005 would drop the source`
      );
    }
    console.log(`[db] 0004 backfill: ${reportIds.length} reports, ${tests} test entries`);
  });
  migrate();
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  getDatabase().exec(`
    ALTER TABLE tests DROP COLUMN projectName;
    ALTER TABLE tests DROP COLUMN suitePath;
    ALTER TABLE tests DROP COLUMN tags;
    ALTER TABLE test_runs DROP COLUMN annotations;
  `);
}
