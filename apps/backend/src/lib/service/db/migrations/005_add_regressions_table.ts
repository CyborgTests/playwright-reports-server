import type Database from 'better-sqlite3';
import { REGRESSIONS_SCHEMA_SQL } from '../schemas.js';
import type { Migration } from './index.js';

// Creates the `regressions` event table.
export const migration005AddRegressionsTable: Migration = {
  id: '005_add_regressions_table',
  description: 'Add regressions event table for green→red transition tracking',
  up: (db: Database.Database) => {
    db.exec(REGRESSIONS_SCHEMA_SQL);
  },
};
