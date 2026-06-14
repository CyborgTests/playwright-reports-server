import { type Kysely, sql } from 'kysely';

// Removes the previous migration tables
//   - `schema_migrations`       — the old forward-migration ledger
//   - `schema_migration_marks`  — the old one-shot run-mark store
// replaced by `kysely_migration` / `kysely_migration_lock`.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS schema_migrations`.execute(db);
  await sql`DROP TABLE IF EXISTS schema_migration_marks`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // The dropped tables were obsolete bookkeeping; there is nothing to restore.
}
