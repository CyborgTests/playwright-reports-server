import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

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

  initializeSchema(db);
  instance[initiatedDb] = db;

  return db;
}

/** Add a column if it does not already exist on the given table. SQLite has
 *  no IF NOT EXISTS for ADD COLUMN, so we introspect via PRAGMA table_info.
 *  Used to migrate persistent DBs forward without dropping data.
 *
 *  Identifier args are interpolated into raw SQL — callers MUST pass static
 *  strings, never user input. The shape check below is a safety net so a
 *  future caller from a route handler can't smuggle in a quote-laden
 *  identifier. */
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_TYPE = /^[A-Za-z_][A-Za-z0-9_ ()]*$/;
function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  type: string
): void {
  if (!SAFE_IDENT.test(table)) throw new Error(`addColumnIfMissing: unsafe table "${table}"`);
  if (!SAFE_IDENT.test(column)) throw new Error(`addColumnIfMissing: unsafe column "${column}"`);
  if (!SAFE_TYPE.test(type)) throw new Error(`addColumnIfMissing: unsafe type "${type}"`);
  const cols = db.pragma(`table_info('${table}')`) as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Drop a column if it still exists on a persistent DB. SQLite supports
 *  `ALTER TABLE … DROP COLUMN` from 3.35; better-sqlite3 ships a newer build.
 *  Identifier args are interpolated raw — callers MUST pass static strings. */
function dropColumnIfExists(db: Database.Database, table: string, column: string): void {
  if (!SAFE_IDENT.test(table)) throw new Error(`dropColumnIfExists: unsafe table "${table}"`);
  if (!SAFE_IDENT.test(column)) throw new Error(`dropColumnIfExists: unsafe column "${column}"`);
  const cols = db.pragma(`table_info('${table}')`) as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
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

function initializeSchema(db: Database.Database): void {
  ensureMigrationMarks(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS results (
      resultID TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      title TEXT,
      createdAt TEXT NOT NULL,
      size TEXT,
      sizeBytes INTEGER,
      metadata TEXT,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_results_ids ON results(resultID);
    CREATE INDEX IF NOT EXISTS idx_results_project ON results(project);
    CREATE INDEX IF NOT EXISTS idx_results_createdAt ON results(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_results_updatedAt ON results(updatedAt DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      reportID TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      title TEXT,
      displayNumber INTEGER,
      createdAt TEXT NOT NULL,
      reportUrl TEXT NOT NULL,
      size TEXT,
      sizeBytes INTEGER,
      stats TEXT,
      metadata TEXT,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_reports_ids ON reports(reportID);
    CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project);
    CREATE INDEX IF NOT EXISTS idx_reports_createdAt ON reports(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_updatedAt ON reports(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_displayNumber ON reports(displayNumber);
    CREATE INDEX IF NOT EXISTS idx_reports_project_created ON reports(project, createdAt DESC);
  `);

  db.exec('DROP TABLE IF EXISTS cache_metadata');

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_results (
      reportId TEXT NOT NULL,
      resultId TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (reportId, resultId)
    );
    CREATE INDEX IF NOT EXISTS idx_report_results_result ON report_results(resultId);
    CREATE INDEX IF NOT EXISTS idx_report_results_report ON report_results(reportId);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tests (
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      filePath TEXT NOT NULL,
      project TEXT NOT NULL,
      title TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (testId, fileId, project)
    );

    CREATE INDEX IF NOT EXISTS idx_tests_project ON tests(project);
    CREATE INDEX IF NOT EXISTS idx_tests_createdAt ON tests(createdAt DESC);
  `);

  addColumnIfMissing(db, 'tests', 'latestRunAt', 'TEXT');
  addColumnIfMissing(db, 'tests', 'latestOutcome', 'TEXT');
  addColumnIfMissing(db, 'tests', 'latestNonSkippedAt', 'TEXT');
  addColumnIfMissing(db, 'tests', 'flakinessScore', 'REAL');
  addColumnIfMissing(db, 'tests', 'quarantined', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'tests', 'quarantineReason', 'TEXT');
  addColumnIfMissing(db, 'tests', 'totalRuns', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'tests', 'recentPassRate', 'REAL');
  addColumnIfMissing(db, 'tests', 'avgDuration', 'REAL');
  addColumnIfMissing(db, 'tests', 'latestFailureCategory', 'TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tests_proj_flakiness
      ON tests(project, flakinessScore DESC);
    CREATE INDEX IF NOT EXISTS idx_tests_proj_lastRunAt
      ON tests(project, latestRunAt DESC);
    CREATE INDEX IF NOT EXISTS idx_tests_proj_avgDuration
      ON tests(project, avgDuration DESC);
    CREATE INDEX IF NOT EXISTS idx_tests_proj_latestFailureCategory
      ON tests(project, latestFailureCategory);
  `);

  // FTS5 search index for the test-management page. The LIKE
  // '%term%' filter force a full scan of `tests` because B-tree indexes
  // can't accelerate leading-wildcard contains-anywhere queries. The
  // trigram tokenizer supports the same substring semantics with an
  // actual index, so a 100k-row dashboard search drops from ~hundreds of
  // ms to single-digit ms. We store testId/fileId/project as UNINDEXED
  // pass-through columns so query results can be joined back to `tests`
  // by the lookup keys without needing a separate ROWID mapping.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS tests_fts USING fts5(
      testId UNINDEXED,
      fileId UNINDEXED,
      project UNINDEXED,
      title,
      filePath,
      tokenize = 'trigram'
    );

    CREATE TRIGGER IF NOT EXISTS tests_fts_insert AFTER INSERT ON tests BEGIN
      INSERT INTO tests_fts(testId, fileId, project, title, filePath)
      VALUES (new.testId, new.fileId, new.project, new.title, new.filePath);
    END;
    CREATE TRIGGER IF NOT EXISTS tests_fts_delete AFTER DELETE ON tests BEGIN
      DELETE FROM tests_fts
      WHERE testId = old.testId AND fileId = old.fileId AND project = old.project;
    END;
    CREATE TRIGGER IF NOT EXISTS tests_fts_update AFTER UPDATE OF title, filePath ON tests BEGIN
      DELETE FROM tests_fts
      WHERE testId = old.testId AND fileId = old.fileId AND project = old.project;
      INSERT INTO tests_fts(testId, fileId, project, title, filePath)
      VALUES (new.testId, new.fileId, new.project, new.title, new.filePath);
    END;
  `);

  if (!hasMigrationMark(db, 'tests_fts_backfill_v1')) {
    db.exec(`
      INSERT INTO tests_fts(testId, fileId, project, title, filePath)
      SELECT testId, fileId, project, title, filePath FROM tests;
    `);
    setMigrationMark(db, 'tests_fts_backfill_v1');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS test_runs (
      runId TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      project TEXT NOT NULL,
      reportId TEXT NOT NULL,
      outcome TEXT NOT NULL,
      duration INTEGER,
      createdAt TEXT NOT NULL,
      flakinessScore REAL DEFAULT 0 NOT NULL,
      quarantineReason TEXT,
      quarantined BOOLEAN DEFAULT FALSE NOT NULL,
      fixedAt TEXT,
      failure_details TEXT,
      failure_category TEXT,
      failure_category_source TEXT,
      error_signature TEXT,
      FOREIGN KEY (testId, fileId, project)
        REFERENCES tests(testId, fileId, project)
    );

    CREATE INDEX IF NOT EXISTS idx_test_runs_testId ON test_runs(testId, project);
    CREATE INDEX IF NOT EXISTS idx_test_runs_reportId ON test_runs(reportId);
    CREATE INDEX IF NOT EXISTS idx_test_runs_createdAt ON test_runs(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_test_runs_outcome ON test_runs(outcome);
    CREATE INDEX IF NOT EXISTS idx_test_runs_test_created ON test_runs(testId, project, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_test_runs_outcome_created ON test_runs(outcome, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_test_runs_quarantined ON test_runs(quarantined);
    CREATE INDEX IF NOT EXISTS idx_test_runs_quarantined_created ON test_runs(quarantined, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_test_runs_failure_category ON test_runs(failure_category);
    CREATE INDEX IF NOT EXISTS idx_test_runs_error_signature ON test_runs(error_signature);
    CREATE INDEX IF NOT EXISTS idx_test_runs_project_created ON test_runs(project, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_test_runs_test_lane_created
      ON test_runs(testId, fileId, project, createdAt DESC);
  `);
  addColumnIfMissing(db, 'test_runs', 'error_signature_global', 'TEXT');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_test_runs_error_signature_global ON test_runs(error_signature_global)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER NOT NULL DEFAULT 0,
      reportId TEXT,
      testId TEXT,
      fileId TEXT,
      project TEXT,
      prompt TEXT,
      result TEXT,
      category TEXT,
      model TEXT,
      error TEXT,
      createdAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT,
      retryCount INTEGER NOT NULL DEFAULT 0,
      maxRetries INTEGER NOT NULL DEFAULT 2,
      inputTokens INTEGER,
      outputTokens INTEGER,
      totalTokens INTEGER,
      isRetry INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_llm_tasks_status ON llm_tasks(status, priority DESC, createdAt);
    CREATE INDEX IF NOT EXISTS idx_llm_tasks_report ON llm_tasks(reportId);
    CREATE INDEX IF NOT EXISTS idx_llm_tasks_type ON llm_tasks(type, status);
  `);
  // ALTER TABLE migrations for upgrades from earlier schema versions.
  addColumnIfMissing(db, 'llm_tasks', 'inputTokens', 'INTEGER');
  addColumnIfMissing(db, 'llm_tasks', 'outputTokens', 'INTEGER');
  addColumnIfMissing(db, 'llm_tasks', 'totalTokens', 'INTEGER');
  addColumnIfMissing(db, 'llm_tasks', 'isRetry', 'INTEGER NOT NULL DEFAULT 0');
  dropColumnIfExists(db, 'llm_tasks', 'promptVersion');
  // JSON-encoded array of reportIDs to feed into the worker. Currently used
  // only by project_summary so the dashboard's selected reports flow through
  // to the LLM input. NULL keeps the legacy "latest N for project" behavior.
  addColumnIfMissing(db, 'llm_tasks', 'reportIds', 'TEXT');
  addColumnIfMissing(db, 'llm_tasks', 'baseUrl', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_failure_summaries (
      reportId TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      totalFailures INTEGER NOT NULL DEFAULT 0,
      categories TEXT NOT NULL DEFAULT '{}',
      llmSummary TEXT,
      llmModel TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      FOREIGN KEY (reportId) REFERENCES reports(reportID)
    );
    CREATE INDEX IF NOT EXISTS idx_rfs_project ON report_failure_summaries(project);
    CREATE INDEX IF NOT EXISTS idx_rfs_created ON report_failure_summaries(createdAt DESC);
  `);
  addColumnIfMissing(db, 'report_failure_summaries', 'llmModel', 'TEXT');
  dropColumnIfExists(db, 'report_failure_summaries', 'errorGroups');
  // Phase 1: structured output for report-level analysis. The column holds
  // the JSON-encoded ReportAnalysisStructured; the legacy llmSummary column
  // keeps a rendered-markdown fallback so older clients keep working.
  addColumnIfMissing(db, 'report_failure_summaries', 'llmSummaryStructured', 'TEXT');
  // One-shot cache wipe: prior summaries were unstructured markdown with the
  // old three-section emoji format. Wipe them so users see the new structured
  // UI on next view; per-report re-summarize triggers a fresh LLM call.
  if (!hasMigrationMark(db, 'rfs_structured_v1')) {
    db.exec('DELETE FROM report_failure_summaries');
    setMigrationMark(db, 'rfs_structured_v1');
  }
  // Second wipe: cluster-shaped prompt + verdict semantics changed (flakes
  // excluded from failure counts, CI/trend tags added). Existing structured
  // payloads were written against the pre-cluster prompt and don't carry
  // the project-on-codeRefs fix from the same release. Wipe so users see
  // fresh analyses with the new shape on next view.
  if (!hasMigrationMark(db, 'rfs_clusters_v2')) {
    db.exec('DELETE FROM report_failure_summaries');
    setMigrationMark(db, 'rfs_clusters_v2');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS test_llm_analyses (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      project TEXT NOT NULL,
      reportId TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      analysis TEXT,
      category TEXT,
      model TEXT,
      -- NULL for fresh LLM-generated analyses; source row id for reused ones (same error_signature).
      reusedFromAnalysisId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      inputTokens INTEGER,
      outputTokens INTEGER,
      totalTokens INTEGER,
      UNIQUE(testId, fileId, project, reportId, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_tla_test ON test_llm_analyses(testId, fileId, project);
    CREATE INDEX IF NOT EXISTS idx_tla_report ON test_llm_analyses(reportId);
    CREATE INDEX IF NOT EXISTS idx_tla_test_report ON test_llm_analyses(testId, reportId);
  `);
  addColumnIfMissing(db, 'test_llm_analyses', 'inputTokens', 'INTEGER');
  addColumnIfMissing(db, 'test_llm_analyses', 'outputTokens', 'INTEGER');
  addColumnIfMissing(db, 'test_llm_analyses', 'totalTokens', 'INTEGER');
  dropColumnIfExists(db, 'test_llm_analyses', 'promptVersion');

  // Drop any pre-existing table that doesn't match the current schema, then recreate.
  // The cache is cheap to regenerate on demand, so a one-shot reset is preferable to
  // accumulating ALTER TABLE migration logic for an evolving schema.
  const expectedProjectSummaryColumns = [
    'project',
    'summary',
    'structured',
    'model',
    'lastReportId',
    'reportCount',
    'firstReportAt',
    'lastReportAt',
    'createdAt',
    'updatedAt',
  ];
  const existingProjectSummaryColumns = (
    db.pragma("table_info('project_llm_summaries')") as Array<{ name: string }>
  ).map((c) => c.name);
  if (
    existingProjectSummaryColumns.length > 0 &&
    expectedProjectSummaryColumns.some((c) => !existingProjectSummaryColumns.includes(c))
  ) {
    db.exec('DROP TABLE project_llm_summaries');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_llm_summaries (
      project TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      structured TEXT,
      model TEXT,
      lastReportId TEXT,
      reportCount INTEGER,
      firstReportAt TEXT,
      lastReportAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS site_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS github_sync_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      repo TEXT NOT NULL,
      workflow TEXT NOT NULL,
      tokenCipher TEXT,
      startDate TEXT NOT NULL,
      artifactPattern TEXT NOT NULL,
      projectTemplate TEXT NOT NULL,
      titleTemplate TEXT NOT NULL,
      cronSchedule TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_github_sync_configs_enabled ON github_sync_configs(enabled);

    CREATE TABLE IF NOT EXISTS github_sync_state (
      artifactId TEXT PRIMARY KEY,
      syncConfigId TEXT NOT NULL,
      reportId TEXT NOT NULL,
      runId TEXT NOT NULL,
      env TEXT,
      runDate TEXT,
      uploadedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_github_sync_state_config ON github_sync_state(syncConfigId);

    CREATE TABLE IF NOT EXISTS github_sync_runs (
      id TEXT PRIMARY KEY,
      syncConfigId TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      finishedAt TEXT,
      uploaded INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_github_sync_runs_config ON github_sync_runs(syncConfigId, startedAt DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_feedback (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      project TEXT NOT NULL,
      reportId TEXT,
      errorSignature TEXT,
      comment TEXT NOT NULL CHECK (length(trim(comment)) > 0),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_af_test
      ON analysis_feedback(testId, fileId, project);
    CREATE INDEX IF NOT EXISTS idx_af_updated
      ON analysis_feedback(updatedAt DESC);
    -- Supports cross-project lookups for same test and signature-match.
    CREATE INDEX IF NOT EXISTS idx_af_test_lookup
      ON analysis_feedback(testId, fileId);
    CREATE INDEX IF NOT EXISTS idx_af_signature
      ON analysis_feedback(errorSignature)
      WHERE errorSignature IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      rule_kind TEXT NOT NULL,
      event TEXT NOT NULL,
      condition TEXT NOT NULL,
      status TEXT NOT NULL,
      skip_reason TEXT,
      http_status INTEGER,
      error TEXT,
      attempt INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notification_log_created
      ON notification_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_log_channel
      ON notification_log(channel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_log_status
      ON notification_log(status, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_state (
      channel_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      last_fired_at INTEGER NOT NULL,
      PRIMARY KEY (channel_id, rule_id, project)
    );
  `);

  // Drift cleanup: an older non-versioned schema in some deployed DBs left a
  // `targetType` column with a NOT NULL constraint and no default. The current
  // code never writes it, so every INSERT 500s with SQLITE_CONSTRAINT_NOTNULL.
  // The same legacy schema also bound `targetType` into some indexes (e.g.
  // `ux_af_test`), so a bare DROP COLUMN errors out — drop every index that
  // mentions the column, then drop the column, then recreate the canonical
  // indexes (which already exist via CREATE INDEX IF NOT EXISTS above for
  // fresh DBs, but were missing the bare form on legacy ones).
  dropAnalysisFeedbackTargetTypeIfPresent(db);
}

function dropAnalysisFeedbackTargetTypeIfPresent(db: Database.Database): void {
  const cols = db.pragma(`table_info('analysis_feedback')`) as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'targetType')) return;

  // Find every index whose definition references `targetType` and drop it.
  // `sqlite_master.sql` is the canonical source for the index definition.
  const indexes = db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND tbl_name = 'analysis_feedback' AND sql IS NOT NULL`
    )
    .all() as Array<{ name: string; sql: string }>;
  for (const idx of indexes) {
    if (idx.sql.includes('targetType') && SAFE_IDENT.test(idx.name)) {
      db.exec(`DROP INDEX IF EXISTS ${idx.name}`);
    }
  }

  db.exec('ALTER TABLE analysis_feedback DROP COLUMN targetType');

  // Re-create the indexes the code expects. Idempotent — no-ops if they
  // survived the targetType binding (i.e. were already on the right columns).
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_af_test
      ON analysis_feedback(testId, fileId, project);
    CREATE INDEX IF NOT EXISTS idx_af_updated
      ON analysis_feedback(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_af_test_lookup
      ON analysis_feedback(testId, fileId);
    CREATE INDEX IF NOT EXISTS idx_af_signature
      ON analysis_feedback(errorSignature)
      WHERE errorSignature IS NOT NULL;
  `);
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
