import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

// Splits `reports.metadata.files[]` into its own column.
// So list queries select the small columns
// only the detail endpoint pulls it.
export const migration002ExtractFilesColumn: Migration = {
  id: '002_extract_files_column',
  description: 'Move bulky metadata.files[] into a dedicated `files` column on reports',
  up: (db: Database.Database) => {
    const cols = db.pragma("table_info('reports')") as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'files')) {
      db.exec('ALTER TABLE reports ADD COLUMN files TEXT');
    }
    db.exec(`
      UPDATE reports
      SET files = json_extract(metadata, '$.files'),
          metadata = json_remove(metadata, '$.files')
      WHERE files IS NULL AND json_extract(metadata, '$.files') IS NOT NULL
    `);
  },
};
