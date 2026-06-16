import { type Kysely, sql } from 'kysely';

// Makes `tests` the single source of truth for flakiness + quarantine.
const DROPPED_RUN_COLUMNS = [
  'flakinessScore',
  'quarantined',
  'quarantineReason',
  'fixedAt',
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE tests ADD COLUMN quarantineFixedAt TEXT`.execute(db);
  await sql`
    UPDATE tests SET quarantineFixedAt = (
      SELECT tr.fixedAt FROM test_runs tr
      WHERE tr.testId = tests.testId AND tr.fileId = tests.fileId AND tr.project = tests.project
        AND tr.outcome != 'skipped'
      ORDER BY tr.createdAt DESC
      LIMIT 1
    )
  `.execute(db);

  await sql`DROP INDEX IF EXISTS idx_test_runs_quarantined_created`.execute(db);
  for (const col of DROPPED_RUN_COLUMNS) {
    await sql.raw(`ALTER TABLE test_runs DROP COLUMN ${col}`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE test_runs ADD COLUMN flakinessScore REAL DEFAULT 0 NOT NULL`.execute(db);
  await sql`ALTER TABLE test_runs ADD COLUMN quarantined BOOLEAN DEFAULT FALSE NOT NULL`.execute(
    db
  );
  await sql`ALTER TABLE test_runs ADD COLUMN quarantineReason TEXT`.execute(db);
  await sql`ALTER TABLE test_runs ADD COLUMN fixedAt TEXT`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_test_runs_quarantined_created ON test_runs(quarantined, createdAt DESC)`.execute(
    db
  );
  await sql`ALTER TABLE tests DROP COLUMN quarantineFixedAt`.execute(db);
}
