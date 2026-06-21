import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS test_trace_baselines (
      testId          TEXT NOT NULL,
      fileId          TEXT NOT NULL,
      project         TEXT NOT NULL,
      sourceReportId  TEXT NOT NULL,
      sourceCreatedAt TEXT NOT NULL,
      sourceOutcome   TEXT NOT NULL,
      network         TEXT NOT NULL,
      dom             TEXT,
      updatedAt       TEXT NOT NULL,
      PRIMARY KEY (testId, fileId, project)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS test_trace_baselines`.execute(db);
}
