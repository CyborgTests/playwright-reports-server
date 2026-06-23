import { type Kysely, sql } from 'kysely';

// normalize report/result tags out of substring-LIKE scans over the `metadata` JSON blob
// into indexed (key,value) rows.
const RESERVED_REPORT_KEYS = [
  'reportID',
  'title',
  'displayNumber',
  'project',
  'createdAt',
  'size',
  'sizeBytes',
  'reportUrl',
  'metadata',
  'stats',
  'files',
  'duration',
  'startTime',
  'errors',
  'projectNames',
  'options',
  'playwrightVersion',
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE report_tags (
      reportId TEXT NOT NULL REFERENCES reports(reportID) ON DELETE CASCADE,
      key TEXT NOT NULL COLLATE NOCASE,
      value TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (reportId, key)
    )
  `.execute(db);
  await sql`CREATE INDEX idx_report_tags_kv ON report_tags(key, value)`.execute(db);

  await sql`
    CREATE TABLE result_tags (
      resultId TEXT NOT NULL REFERENCES results(resultID) ON DELETE CASCADE,
      key TEXT NOT NULL COLLATE NOCASE,
      value TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (resultId, key)
    )
  `.execute(db);
  await sql`CREATE INDEX idx_result_tags_kv ON result_tags(key, value)`.execute(db);

  const reservedList = sql.join(RESERVED_REPORT_KEYS);
  await sql`
    INSERT OR IGNORE INTO report_tags (reportId, key, value)
    SELECT r.reportID, je.key, je.value
    FROM reports r, json_each(r.metadata) je
    WHERE je.type IN ('text', 'integer', 'real')
      AND je.key NOT IN (${reservedList})
  `.execute(db);

  await sql`
    INSERT OR IGNORE INTO result_tags (resultId, key, value)
    SELECT r.resultID, je.key, je.value
    FROM results r, json_each(r.metadata) je
    WHERE je.type IN ('text', 'integer', 'real')
  `.execute(db);

  await sql.raw('ALTER TABLE reports ADD COLUMN gitCommitSubject TEXT').execute(db);
  await sql`
    UPDATE reports SET gitCommitSubject = json_extract(metadata, '$.metadata.gitCommit.subject')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('ALTER TABLE reports DROP COLUMN gitCommitSubject').execute(db);
  await sql`DROP TABLE IF EXISTS result_tags`.execute(db);
  await sql`DROP TABLE IF EXISTS report_tags`.execute(db);
}
