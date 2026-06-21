import { type Kysely, sql } from 'kysely';

// Clustering redesign: reset manual resolutions (cluster IDs changed) and drop
// error_signature_global (redundant with the new keys; index dropped in 0005).
async function hasColumn(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(
    db
  );
  return result.rows.some((r) => r.name === column);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM cluster_resolutions`.execute(db);
  if (await hasColumn(db, 'test_runs', 'error_signature_global')) {
    await sql`ALTER TABLE test_runs DROP COLUMN error_signature_global`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  if (!(await hasColumn(db, 'test_runs', 'error_signature_global'))) {
    await sql`ALTER TABLE test_runs ADD COLUMN error_signature_global TEXT`.execute(db);
  }
}
