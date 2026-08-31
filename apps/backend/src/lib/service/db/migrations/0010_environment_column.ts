import { normalizeEnvironment } from '@playwright-reports/shared';
import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';

export async function up(_db: Kysely<unknown>): Promise<void> {
  const db = getDatabase();

  const migrate = db.transaction(() => {
    db.exec(`
      ALTER TABLE reports ADD COLUMN environment TEXT;
      ALTER TABLE results ADD COLUMN environment TEXT;
    `);

    const reportTagRows = db
      .prepare(`SELECT reportId, value FROM report_tags WHERE key = 'environment'`)
      .all() as Array<{ reportId: string; value: string }>;
    const updateReport = db.prepare(`UPDATE reports SET environment = ? WHERE reportID = ?`);
    for (const row of reportTagRows) {
      const normalized = normalizeEnvironment(row.value);
      if (normalized) updateReport.run(normalized, row.reportId);
    }

    const resultTagRows = db
      .prepare(`SELECT resultId, value FROM result_tags WHERE key = 'environment'`)
      .all() as Array<{ resultId: string; value: string }>;
    const updateResult = db.prepare(`UPDATE results SET environment = ? WHERE resultID = ?`);
    for (const row of resultTagRows) {
      const normalized = normalizeEnvironment(row.value);
      if (normalized) updateResult.run(normalized, row.resultId);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reports_project_environment_createdAt
        ON reports (project, environment, createdAt);
      CREATE INDEX IF NOT EXISTS idx_results_project_environment_createdAt
        ON results (project, environment, createdAt);
    `);

    console.log(
      `[db] 0010 backfill: ${reportTagRows.length} report tags, ${resultTagRows.length} result tags`
    );
  });
  migrate();
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  getDatabase().exec(`
    DROP INDEX IF EXISTS idx_reports_project_environment_createdAt;
    DROP INDEX IF EXISTS idx_results_project_environment_createdAt;
    ALTER TABLE reports DROP COLUMN environment;
    ALTER TABLE results DROP COLUMN environment;
  `);
}
