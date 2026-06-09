import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration003AddPassRateColumn: Migration = {
  id: '003_add_pass_rate_column',
  description: 'Add reports.passRate column (when missing) and backfill from stats',
  up: (db: Database.Database) => {
    const cols = db.pragma("table_info('reports')") as Array<{ name: string }>;
    if (cols.length === 0) return; // fresh DB — schema SQL handles it
    if (!cols.some((c) => c.name === 'passRate')) {
      db.exec('ALTER TABLE reports ADD COLUMN passRate REAL');
    }
    // Backfill: compute passRate from the stats JSON for every row that's
    // missing it. Done with SQLite's JSON1 functions so we don't have to
    // round-trip through the application layer for this one-shot rewrite.
    db.exec(`
      UPDATE reports
      SET passRate = CASE
        WHEN COALESCE(json_extract(stats, '$.expected'), 0)
           + COALESCE(json_extract(stats, '$.unexpected'), 0)
           + COALESCE(json_extract(stats, '$.flaky'), 0) = 0
        THEN NULL
        ELSE 100.0 * COALESCE(json_extract(stats, '$.expected'), 0)
             / (COALESCE(json_extract(stats, '$.expected'), 0)
              + COALESCE(json_extract(stats, '$.unexpected'), 0)
              + COALESCE(json_extract(stats, '$.flaky'), 0))
      END
      WHERE passRate IS NULL AND stats IS NOT NULL
    `);
  },
};
