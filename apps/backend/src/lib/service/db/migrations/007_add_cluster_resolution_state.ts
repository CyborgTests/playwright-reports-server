import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration007AddClusterResolutionState: Migration = {
  id: '007_add_cluster_resolution_state',
  description: 'Add state column to cluster_resolutions table',
  up: (db: Database.Database) => {
    const cols = db.pragma("table_info('cluster_resolutions')") as Array<{ name: string }>;
    if (cols.length === 0) return;
    if (!cols.some((c) => c.name === 'state')) {
      db.exec("ALTER TABLE cluster_resolutions ADD COLUMN state TEXT NOT NULL DEFAULT 'resolved'");
    }
  },
};
