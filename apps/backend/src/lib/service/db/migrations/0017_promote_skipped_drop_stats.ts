import { type Kysely, sql } from 'kysely';

async function hasColumn(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(
    db
  );
  return result.rows.some((r) => r.name === column);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  if (!(await hasColumn(db, 'reports', 'statSkipped'))) {
    await sql`ALTER TABLE reports ADD COLUMN statSkipped REAL`.execute(db);
    if (await hasColumn(db, 'reports', 'stats')) {
      await sql`
        UPDATE reports SET statSkipped = CAST(json_extract(stats, '$.skipped') AS REAL)
        WHERE stats IS NOT NULL
      `.execute(db);
    }
  }
  if (await hasColumn(db, 'reports', 'stats')) {
    await sql`ALTER TABLE reports DROP COLUMN stats`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  if (!(await hasColumn(db, 'reports', 'stats'))) {
    await sql`ALTER TABLE reports ADD COLUMN stats TEXT`.execute(db);
    await sql`
      UPDATE reports SET stats = json_object(
        'total', statTotal, 'expected', statExpected, 'unexpected', statUnexpected,
        'flaky', statFlaky, 'skipped', statSkipped
      ) WHERE statTotal IS NOT NULL
    `.execute(db);
  }
  if (await hasColumn(db, 'reports', 'statSkipped')) {
    await sql`ALTER TABLE reports DROP COLUMN statSkipped`.execute(db);
  }
}
