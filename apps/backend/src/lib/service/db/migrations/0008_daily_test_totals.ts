import type { Kysely } from 'kysely';

/**
 * Daily totals: per-(project, day) pre-aggregated counters and a duration
 * histogram maintained incrementally on report ingest.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('daily_test_totals')
    .addColumn('project', 'text', (col) => col.notNull())
    .addColumn('day', 'text', (col) => col.notNull()) // 'YYYY-MM-DD' UTC
    .addColumn('runs', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('executed', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('passed', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('failed', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('flaky', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('sumDuration', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('durationCount', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('durationBuckets', 'blob') // 256-byte histogram
    .addColumn('updatedAt', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_daily_test_totals', ['project', 'day'])
    .execute();

  await db.schema
    .createTable('daily_test_totals_sources')
    .addColumn('reportId', 'text', (col) => col.notNull())
    .addColumn('project', 'text', (col) => col.notNull())
    .addColumn('day', 'text', (col) => col.notNull())
    .addColumn('deltas', 'text', (col) => col.notNull()) // JSON delta payload
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_daily_test_totals_sources', ['reportId', 'project', 'day'])
    .execute();

  await db.schema
    .createTable('daily_totals_meta')
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('value', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_daily_totals_meta', ['key'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('daily_test_totals_sources').ifExists().execute();
  await db.schema.dropTable('daily_test_totals').ifExists().execute();
  await db.schema.dropTable('daily_totals_meta').ifExists().execute();
}
