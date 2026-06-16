import { type Kysely, sql } from 'kysely';

// Drops two single-column indexes that are strict prefixes of existing
// composites
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_test_runs_outcome`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_tests_project`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS idx_test_runs_outcome ON test_runs(outcome)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tests_project ON tests(project)`.execute(db);
}
