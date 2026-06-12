import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * All TEXT date columns should use ISO 8601 format (YYYY-MM-DDTHH:MM:SS.sssZ).
 *
 * Two non-ISO formats may exist in the database:
 *
 *  1. SQLite CURRENT_TIMESTAMP format: "YYYY-MM-DD HH:MM:SS"
 *     (missing T separator and timezone — written by DEFAULT CURRENT_TIMESTAMP
 *     or explicit sql`CURRENT_TIMESTAMP` in earlier code).
 *
 *  2. JS Date.toDateString() format: "Day Mon DD YYYY" (e.g. "Fri Jun 12 2026")
 *     (written by a now-fixed bug in reports.sqlite.ts insertReport).
 *
 * This migration normalises both formats to ISO 8601 across every table that
 * stores date-like TEXT values.
 */
export const migration008NormalizeDateFormats: Migration = {
  id: '008_normalize_date_formats',
  description: 'Normalise all TEXT date columns to ISO 8601 format',
  up: (db: Database.Database) => {
    // --- Pattern 1: CURRENT_TIMESTAMP format ---
    // Matches exactly "YYYY-MM-DD HH:MM:SS" (19 chars, space at position 11).
    // Convert to "YYYY-MM-DDTHH:MM:SS.000Z".
    const sqliteTsColumns: Array<{ table: string; column: string; nullable: boolean }> = [
      { table: 'reports', column: 'createdAt', nullable: false },
      { table: 'reports', column: 'updatedAt', nullable: true },
      { table: 'results', column: 'createdAt', nullable: false },
      { table: 'results', column: 'updatedAt', nullable: true },
      { table: 'tests', column: 'createdAt', nullable: false },
      { table: 'tests', column: 'latestRunAt', nullable: true },
      { table: 'tests', column: 'latestNonSkippedAt', nullable: true },
      { table: 'tests', column: 'flakinessResetAt', nullable: true },
      { table: 'test_runs', column: 'createdAt', nullable: false },
      { table: 'test_runs', column: 'fixedAt', nullable: true },
      { table: 'report_results', column: 'createdAt', nullable: false },
      { table: 'report_failure_summaries', column: 'createdAt', nullable: false },
      { table: 'report_failure_summaries', column: 'updatedAt', nullable: true },
      { table: 'test_llm_analyses', column: 'createdAt', nullable: false },
      { table: 'test_llm_analyses', column: 'updatedAt', nullable: true },
      { table: 'llm_tasks', column: 'createdAt', nullable: false },
      { table: 'llm_tasks', column: 'startedAt', nullable: true },
      { table: 'llm_tasks', column: 'completedAt', nullable: true },
      { table: 'analysis_feedback', column: 'createdAt', nullable: false },
      { table: 'analysis_feedback', column: 'updatedAt', nullable: true },
      { table: 'project_llm_summaries', column: 'createdAt', nullable: false },
      { table: 'project_llm_summaries', column: 'updatedAt', nullable: true },
      { table: 'project_llm_summaries', column: 'firstReportAt', nullable: true },
      { table: 'project_llm_summaries', column: 'lastReportAt', nullable: true },
      { table: 'github_sync_configs', column: 'createdAt', nullable: false },
      { table: 'github_sync_configs', column: 'updatedAt', nullable: true },
      { table: 'github_sync_state', column: 'uploadedAt', nullable: false },
      { table: 'github_sync_state', column: 'runDate', nullable: true },
      { table: 'github_sync_runs', column: 'startedAt', nullable: false },
      { table: 'github_sync_runs', column: 'finishedAt', nullable: true },
      { table: 'quality_dashboards', column: 'createdAt', nullable: false },
      { table: 'quality_dashboards', column: 'updatedAt', nullable: true },
      { table: 'quality_dashboard_nodes', column: 'createdAt', nullable: false },
      { table: 'quality_dashboard_nodes', column: 'updatedAt', nullable: true },
      { table: 'regressions', column: 'regressedAtCreatedAt', nullable: false },
      { table: 'regressions', column: 'lastGreenCreatedAt', nullable: true },
      { table: 'regressions', column: 'recoveredAtCreatedAt', nullable: true },
      { table: 'cluster_resolutions', column: 'resolvedAt', nullable: false },
      { table: 'site_config', column: 'updatedAt', nullable: false },
    ];

    const existingTables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name)
    );

    let totalFixed = 0;

    for (const { table, column, nullable } of sqliteTsColumns) {
      if (!existingTables.has(table)) continue;
      const cols = db.pragma(`table_info('${table}')`) as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) continue;

      const nullClause = nullable ? `AND ${column} IS NOT NULL` : '';

      // Pattern 1: "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS.000Z"
      const sqliteTs = db.prepare(
        `UPDATE ${table}
         SET ${column} = substr(${column},1,10) || 'T' || substr(${column},12) || '.000Z'
         WHERE length(${column}) = 19
           AND substr(${column},11,1) = ' '
           AND substr(${column},5,1) = '-'
           ${nullClause}`
      );
      const r1 = sqliteTs.run();
      totalFixed += r1.changes;

      // Pattern 2: JS toDateString() — starts with a letter (e.g. "Fri Jun 12 2026")
      const badRows = db
        .prepare(
          `SELECT rowid, ${column} FROM ${table}
         WHERE ${column} GLOB '[A-Z]*' ${nullClause}`
        )
        .all() as Array<{ rowid: number; [key: string]: unknown }>;

      if (badRows.length > 0) {
        const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
        for (const row of badRows) {
          const parsed = new Date(row[column] as string);
          if (!Number.isNaN(parsed.getTime())) {
            update.run(parsed.toISOString(), row.rowid);
            totalFixed++;
          }
        }
      }
    }

    if (totalFixed > 0) {
      console.log(`[migration 008] Normalised ${totalFixed} date values to ISO 8601`);
    }
  },
};
