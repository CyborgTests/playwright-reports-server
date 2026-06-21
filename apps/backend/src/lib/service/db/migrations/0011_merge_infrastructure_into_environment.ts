import { type Kysely, sql } from 'kysely';

// Taxonomy change: the root-cause label set dropped `infrastructure` (it overlapped
// `environment` and nothing branched on the distinction). Remap any persisted
// `infrastructure` root-cause values to `environment` across every column that can
// hold one. `down` is irreversible - the original value is no longer recoverable.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE test_llm_analyses SET category = 'environment' WHERE category = 'infrastructure'`.execute(
    db
  );
  await sql`UPDATE llm_tasks SET category = 'environment' WHERE category = 'infrastructure'`.execute(
    db
  );
  await sql`UPDATE test_runs SET failure_category = 'environment' WHERE failure_category = 'infrastructure'`.execute(
    db
  );
}

export async function down(): Promise<void> {
  // No-op: `infrastructure` and `environment` are indistinguishable after the merge.
}
