import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration004AddFlakinessResetAt: Migration = {
  id: '004_add_flakiness_reset_at',
  description: 'Add tests.flakinessResetAt column for manual flakiness-tracking resets',
  up: (db: Database.Database) => {
    const cols = db.pragma("table_info('tests')") as Array<{ name: string }>;
    if (cols.length === 0) return; // fresh DB — schema SQL handles it
    if (!cols.some((c) => c.name === 'flakinessResetAt')) {
      db.exec('ALTER TABLE tests ADD COLUMN flakinessResetAt TEXT');
    }
  },
};
