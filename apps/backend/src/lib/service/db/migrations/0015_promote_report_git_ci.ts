import { type Kysely, sql } from 'kysely';

// Promote the queried/displayed git + CI fields out of the nested `metadata` JSON
// blob into typed columns
const COLUMNS = ['gitCommitHash', 'gitCommitShortHash', 'gitBranch', 'ciBuildHref'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const col of COLUMNS) {
    await sql.raw(`ALTER TABLE reports ADD COLUMN ${col} TEXT`).execute(db);
  }
  await sql`
    UPDATE reports SET
      gitCommitHash = json_extract(metadata, '$.metadata.gitCommit.hash'),
      gitCommitShortHash = json_extract(metadata, '$.metadata.gitCommit.shortHash'),
      gitBranch = json_extract(metadata, '$.metadata.gitCommit.branch'),
      ciBuildHref = json_extract(metadata, '$.metadata.ci.buildHref')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const col of COLUMNS) {
    await sql.raw(`ALTER TABLE reports DROP COLUMN ${col}`).execute(db);
  }
}
