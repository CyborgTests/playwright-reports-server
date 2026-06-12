import type Database from 'better-sqlite3';
import { migration001FkCascade } from './001_fk_cascade_dependent_tables.js';
import { migration002ExtractFilesColumn } from './002_extract_files_column.js';
import { migration003AddPassRateColumn } from './003_add_pass_rate_column.js';
import { migration004AddFlakinessResetAt } from './004_add_flakiness_reset_at.js';
import { migration005AddRegressionsTable } from './005_add_regressions_table.js';
import { migration006BackfillRegressions } from './006_backfill_regressions.js';
import { migration007AddClusterResolutionState } from './007_add_cluster_resolution_state.js';
import { migration008NormalizeDateFormats } from './008_normalize_date_formats.js';
import { migration009FixStaleReopenedRegressions } from './009_fix_stale_reopened_regressions.js';

export interface Migration {
  id: string;
  description: string;
  up: (db: Database.Database) => void;
}

// Add a new entry here for each forward schema change. Numeric prefixes on
// filenames are advisory — only this list controls execution order. Anything
// already deployed in `main` and applied to existing DBs by boot-time logic
// does NOT need a migration; this framework is for uncommitted forward changes.
const MIGRATIONS: Migration[] = [
  migration001FkCascade,
  migration002ExtractFilesColumn,
  migration003AddPassRateColumn,
  migration004AddFlakinessResetAt,
  migration005AddRegressionsTable,
  migration006BackfillRegressions,
  migration007AddClusterResolutionState,
  migration008NormalizeDateFormats,
  migration009FixStaleReopenedRegressions,
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL,
      description TEXT
    );
  `);

  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{
    id: string;
  }>;
  const applied = new Set(appliedRows.map((r) => r.id));

  const record = db.prepare(
    'INSERT INTO schema_migrations (id, appliedAt, description) VALUES (?, ?, ?)'
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    console.log(`[db] applying migration ${migration.id}: ${migration.description}`);
    db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        migration.up(db);
        record.run(migration.id, new Date().toISOString(), migration.description);
      });
      tx();
      const violations = db.pragma('foreign_key_check') as Array<unknown>;
      if (violations.length > 0) {
        throw new Error(
          `migration ${migration.id} caused FK violations: ${JSON.stringify(violations)}`
        );
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}
