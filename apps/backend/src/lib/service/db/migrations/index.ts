import type { Kysely } from 'kysely';
import { type Migration, Migrator } from 'kysely/migration';
import type { Database } from '../kysely.js';
import * as baseline from './0001_baseline.js';
import * as testRunsDurationIndex from './0002_test_runs_duration_index.js';
import * as llmAnalysesCreatedIndex from './0003_llm_analyses_created_index.js';
import * as testDefinitionColumns from './0004_test_definition_columns.js';
import * as dropReportsFiles from './0005_drop_reports_files.js';

const MIGRATIONS: Record<string, Migration> = {
  '0001_baseline': { up: baseline.up, down: baseline.down },
  '0002_test_runs_duration_index': {
    up: testRunsDurationIndex.up,
    down: testRunsDurationIndex.down,
  },
  '0003_llm_analyses_created_index': {
    up: llmAnalysesCreatedIndex.up,
    down: llmAnalysesCreatedIndex.down,
  },
  '0004_test_definition_columns': {
    up: testDefinitionColumns.up,
    down: testDefinitionColumns.down,
  },
  '0005_drop_reports_files': { up: dropReportsFiles.up, down: dropReportsFiles.down },
};

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
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
