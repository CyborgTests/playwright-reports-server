import { type Kysely, sql } from 'kysely';

// Report counts out of the `stats` / `metadata` JSON blobs into columns
// so analytics aggregates can `SUM` them directly instead of running `json_extract`
// per column per row over
const COLUMNS = ['statTotal', 'statExpected', 'statUnexpected', 'statFlaky', 'durationMs'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const col of COLUMNS) {
    await sql.raw(`ALTER TABLE reports ADD COLUMN ${col} REAL`).execute(db);
  }
  await sql`
    UPDATE reports SET
      statTotal = CAST(json_extract(stats, '$.total') AS REAL),
      statExpected = CAST(json_extract(stats, '$.expected') AS REAL),
      statUnexpected = CAST(json_extract(stats, '$.unexpected') AS REAL),
      statFlaky = CAST(json_extract(stats, '$.flaky') AS REAL),
      durationMs = CAST(json_extract(metadata, '$.duration') AS REAL)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const col of COLUMNS) {
    await sql.raw(`ALTER TABLE reports DROP COLUMN ${col}`).execute(db);
  }
}
