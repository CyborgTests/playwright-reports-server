import type { Kysely } from 'kysely';

/**
 * Retry state for artifacts that failed to download or upload.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('github_sync_failed_artifacts')
    .addColumn('artifactId', 'text', (col) => col.primaryKey())
    .addColumn('syncConfigId', 'text', (col) => col.notNull())
    .addColumn('runId', 'text', (col) => col.notNull())
    .addColumn('artifactName', 'text', (col) => col.notNull())
    .addColumn('env', 'text')
    .addColumn('runDate', 'text')
    .addColumn('headBranch', 'text')
    .addColumn('workflowName', 'text')
    .addColumn('phase', 'text', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('lastError', 'text')
    .addColumn('firstFailedAt', 'text', (col) => col.notNull())
    .addColumn('lastAttemptAt', 'text', (col) => col.notNull())
    .addColumn('abandonedReason', 'text')
    .execute();

  await db.schema
    .createIndex('idx_github_sync_failed_config')
    .on('github_sync_failed_artifacts')
    .column('syncConfigId')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('github_sync_failed_artifacts').ifExists().execute();
}
