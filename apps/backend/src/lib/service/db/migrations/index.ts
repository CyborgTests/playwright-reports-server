import type { Kysely } from 'kysely';
import { type Migration, Migrator } from 'kysely/migration';
import { getDatabase } from '../db.js';
import type { Database } from '../kysely.js';
import * as baseline from './0001_baseline.js';

const MIGRATIONS: Record<string, Migration> = {
  '0001_baseline': { up: baseline.up, down: baseline.down },
};

// One-time transition shim.
function normalizeLegacyMigrationHistory(): void {
  const db = getDatabase();
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kysely_migration'")
    .get();
  if (!hasTable) {
    return;
  }
  const isLegacy = db
    .prepare("SELECT 1 FROM kysely_migration WHERE name = '0002_drop_legacy_tables'")
    .get();
  if (isLegacy) {
    db.prepare("DELETE FROM kysely_migration WHERE name <> '0001_baseline'").run();
    console.log('[db] collapsed pre-consolidation migration history to 0001_baseline');
  }
}

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  normalizeLegacyMigrationHistory();

  const migrator = new Migrator({ db, provider: { getMigrations: async () => MIGRATIONS } });
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
