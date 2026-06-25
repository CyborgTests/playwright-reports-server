import { type Kysely, sql } from 'kysely';

// Reports/results created before the schema-fix stored size as string.
// SQLite keeps non-numeric text verbatim, so `SUM(sizeBytes)` coerced those rows to ~0 and the
// storage under-reported. Parse the string back to a byte
// count for the affected rows.
async function backfillSizeBytes(db: Kysely<unknown>, table: 'reports' | 'results'): Promise<void> {
  const tableRef = sql.raw(table);
  await sql`
    UPDATE ${tableRef}
    SET sizeBytes = CAST(
      CAST(sizeBytes AS REAL) * (
        CASE trim(substr(sizeBytes, instr(sizeBytes, ' ') + 1))
          WHEN 'B'  THEN 1
          WHEN 'KB' THEN 1024
          WHEN 'MB' THEN 1048576
          WHEN 'GB' THEN 1073741824
          WHEN 'TB' THEN 1099511627776
          ELSE 1
        END
      ) AS INTEGER
    )
    WHERE typeof(sizeBytes) = 'text' AND instr(sizeBytes, ' ') > 0
  `.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await backfillSizeBytes(db, 'reports');
  await backfillSizeBytes(db, 'results');
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Data-only correction of malformed values — no schema change to revert.
}
