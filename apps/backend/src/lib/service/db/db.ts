import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { runMigrations } from './migrations/index.js';
import {
  ANALYSIS_FEEDBACK_SCHEMA_SQL,
  FAILURE_SUMMARY_SCHEMA_SQL,
  GITHUB_SYNC_SCHEMA_SQL,
  LLM_TASKS_SCHEMA_SQL,
  NOTIFICATION_LOG_SCHEMA_SQL,
  NOTIFICATION_STATE_SCHEMA_SQL,
  PROJECT_SUMMARY_SCHEMA_SQL,
  QUALITY_DASHBOARDS_SCHEMA_SQL,
  REPORT_RESULTS_SCHEMA_SQL,
  REPORTS_SCHEMA_SQL,
  RESULTS_SCHEMA_SQL,
  SITE_CONFIG_SCHEMA_SQL,
  TEST_ANALYSIS_SCHEMA_SQL,
  TESTS_SCHEMA_SQL,
} from './schemas.js';

const initiatedDb = Symbol.for('playwright.reports.db');
const instance = globalThis as typeof globalThis & {
  [initiatedDb]?: Database.Database;
};

export function createDatabase(): Database.Database {
  if (instance[initiatedDb]) {
    return instance[initiatedDb];
  }

  const dbDir = path.join(process.cwd(), 'data');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'metadata.db');

  console.log(`[db] creating database at ${dbPath}`);

  const db = new Database(dbPath, {
    // Set verbose to console.log to trace every SQL statement.
    verbose: undefined,
  });

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000');
  db.pragma('mmap_size = 134217728');
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = ON');
  db.pragma('auto_vacuum = INCREMENTAL');

  runMigrations(db);
  initializeSchema(db);
  instance[initiatedDb] = db;

  return db;
}

/** One-shot migration marks. The table is a tiny key/value store of
 *  migration identifiers that have already been applied on this DB. Use it
 *  for one-time data migrations (e.g., cache wipes) that should not run on
 *  every server start. */
function ensureMigrationMarks(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration_marks (
      mark TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    );
  `);
}

export function hasMigrationMark(db: Database.Database, mark: string): boolean {
  const row = db.prepare('SELECT 1 FROM schema_migration_marks WHERE mark = ?').get(mark) as
    | { 1: number }
    | undefined;
  return !!row;
}

export function setMigrationMark(db: Database.Database, mark: string): void {
  db.prepare('INSERT OR IGNORE INTO schema_migration_marks (mark, appliedAt) VALUES (?, ?)').run(
    mark,
    new Date().toISOString()
  );
}

const SCHEMA_MODULES: Array<{ name: string; sql: string }> = [
  { name: 'results', sql: RESULTS_SCHEMA_SQL },
  { name: 'reports', sql: REPORTS_SCHEMA_SQL },
  { name: 'report_results', sql: REPORT_RESULTS_SCHEMA_SQL },
  { name: 'tests', sql: TESTS_SCHEMA_SQL },
  { name: 'llm_tasks', sql: LLM_TASKS_SCHEMA_SQL },
  { name: 'failure_summary', sql: FAILURE_SUMMARY_SCHEMA_SQL },
  { name: 'test_analysis', sql: TEST_ANALYSIS_SCHEMA_SQL },
  { name: 'project_summary', sql: PROJECT_SUMMARY_SCHEMA_SQL },
  { name: 'site_config', sql: SITE_CONFIG_SCHEMA_SQL },
  { name: 'github_sync', sql: GITHUB_SYNC_SCHEMA_SQL },
  { name: 'analysis_feedback', sql: ANALYSIS_FEEDBACK_SCHEMA_SQL },
  { name: 'notification_log', sql: NOTIFICATION_LOG_SCHEMA_SQL },
  { name: 'notification_state', sql: NOTIFICATION_STATE_SCHEMA_SQL },
  { name: 'quality_dashboards', sql: QUALITY_DASHBOARDS_SCHEMA_SQL },
];

function initializeSchema(db: Database.Database): void {
  ensureMigrationMarks(db);

  for (const mod of SCHEMA_MODULES) {
    db.exec(mod.sql);
  }
}

export function getDatabase(): Database.Database {
  if (!instance[initiatedDb]) {
    return createDatabase();
  }

  return instance[initiatedDb];
}

export function closeDatabase(): void {
  if (instance[initiatedDb]) {
    console.log('[db] closing database connection');
    const db = getDatabase();

    db.close();
    instance[initiatedDb] = undefined;
  }
}

export function getDatabaseStats(): {
  results: number;
  reports: number;
  sizeOnDisk: string;
  estimatedRAM: string;
} {
  const db = getDatabase();

  const resultsCount = db.prepare('SELECT COUNT(*) as count FROM results').get() as {
    count: number;
  };
  const reportsCount = db.prepare('SELECT COUNT(*) as count FROM reports').get() as {
    count: number;
  };

  const stats = {
    pageCount: db.pragma('page_count', { simple: true }) as number,
    pageSize: db.pragma('page_size', { simple: true }) as number,
    cacheSize: db.pragma('cache_size', { simple: true }) as number,
  };

  const dbSizeBytes = stats.pageCount * stats.pageSize;
  const cacheSizeBytes = Math.abs(stats.cacheSize) * (stats.cacheSize < 0 ? 1024 : stats.pageSize);

  return {
    results: resultsCount.count,
    reports: reportsCount.count,
    sizeOnDisk: `${(dbSizeBytes / 1024 / 1024).toFixed(2)} MB`,
    estimatedRAM: `~${(cacheSizeBytes / 1024 / 1024).toFixed(2)} MB`,
  };
}

export function clearAll(): void {
  const db = getDatabase();

  db.exec(`
    DELETE FROM results;
    DELETE FROM reports;
    DELETE FROM test_runs;
    DELETE FROM tests;
    DELETE FROM llm_tasks;
    DELETE FROM report_failure_summaries;
    DELETE FROM test_llm_analyses;
    DELETE FROM project_llm_summaries;
    DELETE FROM analysis_feedback;
  `);

  db.exec('VACUUM;');
}

export function optimizeDB(): void {
  const db = getDatabase();

  db.exec('ANALYZE;');
  db.exec('PRAGMA incremental_vacuum;');
}
