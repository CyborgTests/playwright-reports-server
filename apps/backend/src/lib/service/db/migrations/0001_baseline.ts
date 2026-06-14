import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';
import {
  ANALYSIS_FEEDBACK_SCHEMA_SQL,
  CLUSTER_RESOLUTIONS_SCHEMA_SQL,
  FAILURE_SUMMARY_SCHEMA_SQL,
  GITHUB_SYNC_SCHEMA_SQL,
  LLM_TASKS_SCHEMA_SQL,
  NOTIFICATION_LOG_SCHEMA_SQL,
  NOTIFICATION_STATE_SCHEMA_SQL,
  PROJECT_SUMMARY_SCHEMA_SQL,
  QUALITY_DASHBOARDS_SCHEMA_SQL,
  REGRESSIONS_SCHEMA_SQL,
  REPORT_RESULTS_SCHEMA_SQL,
  REPORTS_SCHEMA_SQL,
  RESULTS_SCHEMA_SQL,
  SITE_CONFIG_SCHEMA_SQL,
  TEST_ANALYSIS_SCHEMA_SQL,
  TESTS_SCHEMA_SQL,
} from '../schemas.js';

// Frozen baseline schema.
// Do NOT edit this list to evolve the schema.
// Add a new numbered migration with the forward change instead.
const BASELINE_BLOCKS: string[] = [
  RESULTS_SCHEMA_SQL,
  REPORTS_SCHEMA_SQL,
  REPORT_RESULTS_SCHEMA_SQL,
  TESTS_SCHEMA_SQL,
  LLM_TASKS_SCHEMA_SQL,
  FAILURE_SUMMARY_SCHEMA_SQL,
  TEST_ANALYSIS_SCHEMA_SQL,
  PROJECT_SUMMARY_SCHEMA_SQL,
  SITE_CONFIG_SCHEMA_SQL,
  GITHUB_SYNC_SCHEMA_SQL,
  ANALYSIS_FEEDBACK_SCHEMA_SQL,
  NOTIFICATION_LOG_SCHEMA_SQL,
  NOTIFICATION_STATE_SCHEMA_SQL,
  QUALITY_DASHBOARDS_SCHEMA_SQL,
  REGRESSIONS_SCHEMA_SQL,
  CLUSTER_RESOLUTIONS_SCHEMA_SQL,
];

export async function up(_db: Kysely<unknown>): Promise<void> {
  const db = getDatabase();
  for (const block of BASELINE_BLOCKS) {
    db.exec(block);
  }
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // The baseline has no `down`: dropping every table would destroy all data.
  // If a full teardown is ever needed, do it explicitly.
}
