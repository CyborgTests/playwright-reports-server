import { type Kysely, sql } from 'kysely';

// Per-role observability for multi-strategy routing.
// A logical task becomes the PARENT; each strategy role call (author/synthesizer/judge/critic/reviser/tier/scorer) 
// is recorded as a CHILD row linked by parentTaskId. `strategy` is stamped on the parent.
async function hasColumn(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(
    db
  );
  return result.rows.some((r) => r.name === column);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (!(await hasColumn(db, 'llm_tasks', 'parentTaskId'))) {
    await sql`ALTER TABLE llm_tasks ADD COLUMN parentTaskId TEXT`.execute(db);
  }
  if (!(await hasColumn(db, 'llm_tasks', 'role'))) {
    await sql`ALTER TABLE llm_tasks ADD COLUMN role TEXT`.execute(db);
  }
  if (!(await hasColumn(db, 'llm_tasks', 'strategy'))) {
    await sql`ALTER TABLE llm_tasks ADD COLUMN strategy TEXT`.execute(db);
  }
  await sql`CREATE INDEX IF NOT EXISTS idx_llm_tasks_parent ON llm_tasks(parentTaskId)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_llm_tasks_parent`.execute(db);
  if (await hasColumn(db, 'llm_tasks', 'parentTaskId')) {
    await sql`ALTER TABLE llm_tasks DROP COLUMN parentTaskId`.execute(db);
  }
  if (await hasColumn(db, 'llm_tasks', 'role')) {
    await sql`ALTER TABLE llm_tasks DROP COLUMN role`.execute(db);
  }
  if (await hasColumn(db, 'llm_tasks', 'strategy')) {
    await sql`ALTER TABLE llm_tasks DROP COLUMN strategy`.execute(db);
  }
}
