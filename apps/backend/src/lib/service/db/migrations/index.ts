import type { Kysely } from 'kysely';
import { type Migration, type MigrationProvider, Migrator } from 'kysely/migration';
import type { Database } from '../kysely.js';
import * as baseline from './0001_baseline.js';
import * as dropLegacyTables from './0002_drop_legacy_tables.js';
import * as seedDefaultDashboard from './0003_seed_default_dashboard.js';
import * as testFkCascade from './0004_test_fk_cascade.js';
import * as pruneIndexes from './0005_prune_indexes.js';
import * as promoteReportStats from './0006_promote_report_stats.js';
import * as testStateToTestLevel from './0007_test_state_to_test_level.js';

// Ordered, statically-imported migration set. The keys are the names Kysely
// records in its `kysely_migration` table; their lexical order is the run order,
// so keep the numeric prefixes. The baseline (0001) is frozen and must never be edited.
const MIGRATIONS: Record<string, Migration> = {
  '0001_baseline': { up: baseline.up, down: baseline.down },
  '0002_drop_legacy_tables': { up: dropLegacyTables.up, down: dropLegacyTables.down },
  '0003_seed_default_dashboard': { up: seedDefaultDashboard.up, down: seedDefaultDashboard.down },
  '0004_test_fk_cascade': { up: testFkCascade.up, down: testFkCascade.down },
  '0005_prune_indexes': { up: pruneIndexes.up, down: pruneIndexes.down },
  '0006_promote_report_stats': { up: promoteReportStats.up, down: promoteReportStats.down },
  '0007_test_state_to_test_level': {
    up: testStateToTestLevel.up,
    down: testStateToTestLevel.down,
  },
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS;
  }
}

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });
  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`[db] migration applied: ${result.migrationName}`);
    } else if (result.status === 'Error') {
      console.error(`[db] migration failed: ${result.migrationName}`);
    }
  }

  if (error) {
    throw error instanceof Error ? error : new Error(`db migration failed: ${String(error)}`);
  }
}
