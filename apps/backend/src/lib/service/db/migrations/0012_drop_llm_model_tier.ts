import { type Kysely, sql } from 'kysely';

async function hasColumn(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(
    db
  );
  return result.rows.some((r) => r.name === column);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (await hasColumn(db, 'llm_models', 'tier')) {
    await sql`ALTER TABLE llm_models DROP COLUMN tier`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  if (!(await hasColumn(db, 'llm_models', 'tier'))) {
    await sql`ALTER TABLE llm_models ADD COLUMN tier TEXT`.execute(db);
  }
}
