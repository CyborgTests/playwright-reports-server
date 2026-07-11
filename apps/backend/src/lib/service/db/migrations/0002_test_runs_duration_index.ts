import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';

// Analytics p95 (ORDER BY duration ASC LIMIT/OFFSET) and slowest-tests
// (ORDER BY duration DESC LIMIT) file-sorted the whole table.
// need a plain duration index does.
export async function up(_db: Kysely<unknown>): Promise<void> {
  getDatabase().exec('CREATE INDEX IF NOT EXISTS idx_test_runs_duration ON test_runs(duration)');
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  getDatabase().exec('DROP INDEX IF EXISTS idx_test_runs_duration');
}
