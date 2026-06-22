import { type Kysely, sql } from 'kysely';

async function hasColumn(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(
    db
  );
  return result.rows.some((r) => r.name === column);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS llm_concurrency_groups (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL UNIQUE,
      concurrencyLimit INTEGER NOT NULL DEFAULT 1,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL
    )
  `.execute(db);

  // Nullable = ungrouped. Existing models stay ungrouped, so effective concurrency
  // is byte-for-byte the prior Σ per-model behaviour until a group is assigned.
  if (!(await hasColumn(db, 'llm_models', 'concurrencyGroupId'))) {
    await sql`ALTER TABLE llm_models ADD COLUMN concurrencyGroupId TEXT`.execute(db);
  }
  await sql`CREATE INDEX IF NOT EXISTS idx_llm_models_group ON llm_models(concurrencyGroupId)`.execute(
    db
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_llm_models_group`.execute(db);
  if (await hasColumn(db, 'llm_models', 'concurrencyGroupId')) {
    await sql`ALTER TABLE llm_models DROP COLUMN concurrencyGroupId`.execute(db);
  }
  await sql`DROP TABLE IF EXISTS llm_concurrency_groups`.execute(db);
}
