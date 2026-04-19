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
    verbose: undefined, // for debugging: console.log
  });

  db.pragma('journal_mode = WAL'); // better concurrency
  db.pragma('synchronous = NORMAL'); // faster writes, still safe with WAL
  db.pragma('cache_size = -8000'); // 8MB page cache (balance of speed and memory)
  db.pragma('mmap_size = 134217728'); // 128MB memory-mapped I/O
  db.pragma('temp_store = MEMORY'); // store temporary tables in RAM
  db.pragma('foreign_keys = ON'); // enforce referential integrity
  db.pragma('auto_vacuum = INCREMENTAL'); // manage file size

  console.log('[db] database is configured');

  initializeSchema(db);
  instance[initiatedDb] = db;

  return db;
}

function initializeSchema(db: Database.Database): void {
  console.log('[db] initializing schema');

  db.exec(`
    CREATE TABLE IF NOT EXISTS results (
      resultID TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      title TEXT,
      createdAt TEXT NOT NULL,
      size TEXT,
      sizeBytes INTEGER,
      metadata TEXT, -- JSON string for additional metadata
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for common queries
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
      stats TEXT, -- JSON string for report stats
      metadata TEXT, -- JSON string for additional metadata
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for common queries
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

    -- Indexes for tests table
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
      FOREIGN KEY (testId, fileId, project)
        REFERENCES tests(testId, fileId, project)
    );

    -- Indexes for test_runs table
    CREATE INDEX IF NOT EXISTS idx_test_runs_testId ON test_runs(testId, project);
    CREATE INDEX IF NOT EXISTS idx_test_runs_reportId ON test_runs(reportId);
    CREATE INDEX IF NOT EXISTS idx_test_runs_createdAt ON test_runs(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_test_runs_outcome ON test_runs(outcome);
    CREATE INDEX IF NOT EXISTS idx_test_runs_test_created ON test_runs(testId, project, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_test_runs_outcome_created ON test_runs(outcome, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_test_runs_quarantined ON test_runs(quarantined);
    CREATE INDEX IF NOT EXISTS idx_test_runs_quarantined_created ON test_runs(quarantined, createdAt DESC);
  `);

  // Failure analysis columns migration
  const addColumnIfNotExists = (table: string, column: string, type: string) => {
    const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!columns.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  };
  addColumnIfNotExists('test_runs', 'failure_details', 'TEXT');
  addColumnIfNotExists('test_runs', 'failure_category', 'TEXT');
  addColumnIfNotExists('test_runs', 'error_signature', 'TEXT');

  db.exec(`
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
      maxRetries INTEGER NOT NULL DEFAULT 2
    );
    CREATE INDEX IF NOT EXISTS idx_llm_tasks_status ON llm_tasks(status, priority DESC, createdAt);
    CREATE INDEX IF NOT EXISTS idx_llm_tasks_report ON llm_tasks(reportId);
    CREATE INDEX IF NOT EXISTS idx_llm_tasks_type ON llm_tasks(type, status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_failure_summaries (
      reportId TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      totalFailures INTEGER NOT NULL DEFAULT 0,
      categories TEXT NOT NULL DEFAULT '{}',
      errorGroups TEXT NOT NULL DEFAULT '[]',
      llmSummary TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      FOREIGN KEY (reportId) REFERENCES reports(reportID)
    );
    CREATE INDEX IF NOT EXISTS idx_rfs_project ON report_failure_summaries(project);
    CREATE INDEX IF NOT EXISTS idx_rfs_created ON report_failure_summaries(createdAt DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS test_llm_analyses (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      project TEXT NOT NULL,
      reportId TEXT NOT NULL,
      analysis TEXT,
      category TEXT,
      model TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      UNIQUE(testId, fileId, project)
    );
    CREATE INDEX IF NOT EXISTS idx_tla_test ON test_llm_analyses(testId, fileId, project);
    CREATE INDEX IF NOT EXISTS idx_tla_report ON test_llm_analyses(reportId);
  `);

  console.log('[db] schema initialized');
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

  console.log('[db] clearing all data');

  db.exec(`
    DELETE FROM results;
    DELETE FROM reports;
    DELETE FROM cache_metadata;
    DELETE FROM test_runs;
    DELETE FROM tests;
    DELETE FROM llm_tasks;
    DELETE FROM report_failure_summaries;
    DELETE FROM test_llm_analyses;
  `);

  db.exec('VACUUM;');

  console.log('[db] cleared');
}

export function optimizeDB(): void {
  const db = getDatabase();

  console.log('[db] optimizing database');

  db.exec('ANALYZE;');
  db.exec('PRAGMA incremental_vacuum;');

  console.log('[db] optimization complete');
}
