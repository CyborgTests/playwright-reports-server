import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';

const ADD_COLUMNS = `
  ALTER TABLE reports ADD COLUMN tracesDeletedAt TEXT;
  ALTER TABLE reports ADD COLUMN videosDeletedAt TEXT;
  ALTER TABLE reports ADD COLUMN screenshotsDeletedAt TEXT;
  ALTER TABLE reports ADD COLUMN artifactsMissingAt TEXT;
  ALTER TABLE reports ADD COLUMN attachmentSizes TEXT;
`;

interface StoredConfig {
  cron?: {
    reportExpireDays?: number;
    resultExpireDays?: number;
    cleanupConfirmations?: unknown;
  };
}

export async function up(_db: Kysely<unknown>): Promise<void> {
  const db = getDatabase();

  const migrate = db.transaction(() => {
    db.exec(ADD_COLUMNS);

    const row = db.prepare('SELECT config FROM site_config WHERE id = 1').get() as
      | { config: string }
      | undefined;
    if (!row) return;

    let parsed: StoredConfig | null;
    try {
      parsed = JSON.parse(row.config);
    } catch {
      return;
    }

    const cron = parsed?.cron;
    if (!cron || typeof cron !== 'object' || cron.cleanupConfirmations) return;

    const confirmedAt = new Date().toISOString();
    const confirmations: Record<string, { confirmedAt: string; confirmedDays: number }> = {};
    if (typeof cron.reportExpireDays === 'number' && cron.reportExpireDays > 0) {
      confirmations.reports = { confirmedAt, confirmedDays: cron.reportExpireDays };
    }
    if (typeof cron.resultExpireDays === 'number' && cron.resultExpireDays > 0) {
      confirmations.results = { confirmedAt, confirmedDays: cron.resultExpireDays };
    }
    if (Object.keys(confirmations).length === 0) return;

    cron.cleanupConfirmations = confirmations;
    db.prepare('UPDATE site_config SET config = ?, updatedAt = ? WHERE id = 1').run(
      JSON.stringify(parsed),
      confirmedAt
    );
    console.log(
      `[db] 0007 confirmed pre-existing cleanup windows: ${Object.keys(confirmations).join(', ')}`
    );
  });

  migrate();
}
