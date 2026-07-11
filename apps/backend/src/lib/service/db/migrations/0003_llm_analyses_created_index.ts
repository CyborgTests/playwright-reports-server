import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';

// LLM usage-stats filter `WHERE createdAt >= ?` full-scanned test_llm_analyses
// (only idx_tla_test / _report / _test_report existed).
export async function up(_db: Kysely<unknown>): Promise<void> {
  getDatabase().exec('CREATE INDEX IF NOT EXISTS idx_tla_created ON test_llm_analyses(createdAt)');
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  getDatabase().exec('DROP INDEX IF EXISTS idx_tla_created');
}
