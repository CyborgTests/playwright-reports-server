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

function initializeSchema(db: Database.Database): void {
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
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
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
  `);

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
      promptVersion TEXT,
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
  addColumnIfMissing(db, 'llm_tasks', 'promptVersion', 'TEXT');
  addColumnIfMissing(db, 'llm_tasks', 'isRetry', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_failure_summaries (
      reportId TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      totalFailures INTEGER NOT NULL DEFAULT 0,
      categories TEXT NOT NULL DEFAULT '{}',
      errorGroups TEXT NOT NULL DEFAULT '[]',
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
      promptVersion TEXT,
      UNIQUE(testId, fileId, project, reportId, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_tla_test ON test_llm_analyses(testId, fileId, project);
    CREATE INDEX IF NOT EXISTS idx_tla_report ON test_llm_analyses(reportId);
    CREATE INDEX IF NOT EXISTS idx_tla_test_report ON test_llm_analyses(testId, reportId);
  `);
  addColumnIfMissing(db, 'test_llm_analyses', 'inputTokens', 'INTEGER');
  addColumnIfMissing(db, 'test_llm_analyses', 'outputTokens', 'INTEGER');
  addColumnIfMissing(db, 'test_llm_analyses', 'totalTokens', 'INTEGER');
  addColumnIfMissing(db, 'test_llm_analyses', 'promptVersion', 'TEXT');

  // Drop any pre-existing table that doesn't match the current schema, then recreate.
  // The cache is cheap to regenerate on demand, so a one-shot reset is preferable to
  // accumulating ALTER TABLE migration logic for an evolving schema.
  const expectedProjectSummaryColumns = [
    'project',
    'summary',
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
    DELETE FROM cache_metadata;
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
