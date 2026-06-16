import { type Kysely, sql } from 'kysely';

const DROP = [
  'idx_reports_updatedAt',
  'idx_results_updatedAt',
  'idx_test_runs_error_signature_global',
  'idx_af_signature',
  'idx_github_sync_configs_enabled',
  'idx_quality_nodes_project',
  'idx_cluster_resolutions_project',
  'idx_reports_project',
  'idx_report_results_report',
  'idx_af_test_lookup',
  'idx_results_project',
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS idx_results_project_created ON results(project, createdAt DESC)`.execute(
    db
  );
  for (const name of DROP) {
    await sql.raw(`DROP INDEX IF EXISTS ${name}`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS idx_reports_updatedAt ON reports(updatedAt DESC)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_results_updatedAt ON results(updatedAt DESC)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_test_runs_error_signature_global ON test_runs(error_signature_global)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_af_signature ON analysis_feedback(errorSignature) WHERE errorSignature IS NOT NULL`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_github_sync_configs_enabled ON github_sync_configs(enabled)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_quality_nodes_project ON quality_dashboard_nodes(dashboardId, projectName)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_cluster_resolutions_project ON cluster_resolutions(project, resolvedAt DESC)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_report_results_report ON report_results(reportId)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_af_test_lookup ON analysis_feedback(testId, fileId)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_results_project ON results(project)`.execute(db);
  await sql.raw('DROP INDEX IF EXISTS idx_results_project_created').execute(db);
}
