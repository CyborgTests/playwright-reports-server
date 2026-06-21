import { type Kysely, sql } from 'kysely';

// Record whether a test run has a Playwright trace attachment, set at ingestion from the
// report payload.
async function hasColumn(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(
    db
  );
  return result.rows.some((r) => r.name === column);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (!(await hasColumn(db, 'test_runs', 'has_trace'))) {
    await sql`ALTER TABLE test_runs ADD COLUMN has_trace INTEGER NOT NULL DEFAULT 0`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  if (await hasColumn(db, 'test_runs', 'has_trace')) {
    await sql`ALTER TABLE test_runs DROP COLUMN has_trace`.execute(db);
  }
}
