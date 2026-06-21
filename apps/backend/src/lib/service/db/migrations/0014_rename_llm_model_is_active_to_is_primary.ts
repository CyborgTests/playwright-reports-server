import { type Kysely, sql } from 'kysely';

// Rename the misleading `isActive` flag on llm_models to `isPrimary`
async function hasColumn(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(
    db
  );
  return result.rows.some((r) => r.name === column);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (
    (await hasColumn(db, 'llm_models', 'isActive')) &&
    !(await hasColumn(db, 'llm_models', 'isPrimary'))
  ) {
    await sql`ALTER TABLE llm_models RENAME COLUMN isActive TO isPrimary`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  if (
    (await hasColumn(db, 'llm_models', 'isPrimary')) &&
    !(await hasColumn(db, 'llm_models', 'isActive'))
  ) {
    await sql`ALTER TABLE llm_models RENAME COLUMN isPrimary TO isActive`.execute(db);
  }
}
