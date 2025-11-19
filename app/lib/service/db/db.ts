import path from 'node:path';
import fs from 'node:fs';

import Database from 'better-sqlite3';

import { isBuildStage } from '@/app/config/runtime';

const initiatedDb = Symbol.for('playwright.reports.db');
const instance = globalThis as typeof globalThis & { [initiatedDb]?: Database.Database };

export function createDatabase(): Database.Database {
  if (instance[initiatedDb]) {
    return instance[initiatedDb];
  }

  // for build stage use an in-memory database to avoid file locking issues
  if (isBuildStage) {
    console.log('[db] build stage detected, using in-memory database');
    const db = new Database(':memory:');

    initializeSchema(db);
    instance[initiatedDb] = db;

    return db;
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
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
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
  resultsCount: number;
  reportsCount: number;
  configExists: boolean;
  dbSizeOnDisk: string;
  estimatedRAM: string;
} {
  const db = getDatabase();

  const resultsCount = db.prepare('SELECT COUNT(*) as count FROM results').get() as { count: number };
  const reportsCount = db.prepare('SELECT COUNT(*) as count FROM reports').get() as { count: number };
  const configExists = db.prepare('SELECT COUNT(*) as count FROM config').get() as { count: number };

  const stats = {
    pageCount: db.pragma('page_count', { simple: true }) as number,
    pageSize: db.pragma('page_size', { simple: true }) as number,
    cacheSize: db.pragma('cache_size', { simple: true }) as number,
  };

  const dbSizeBytes = stats.pageCount * stats.pageSize;
  const cacheSizeBytes = Math.abs(stats.cacheSize) * (stats.cacheSize < 0 ? 1024 : stats.pageSize);

  return {
    resultsCount: resultsCount.count,
    reportsCount: reportsCount.count,
    configExists: configExists.count > 0,
    dbSizeOnDisk: `${(dbSizeBytes / 1024 / 1024).toFixed(2)} MB`,
    estimatedRAM: `${(cacheSizeBytes / 1024 / 1024).toFixed(2)} MB`,
  };
}

export function clearAll(): void {
  const db = getDatabase();

  console.log('[db] clearing all data');

  db.exec(`
    DELETE FROM results;
    DELETE FROM reports;
    DELETE FROM config;
    DELETE FROM cache_metadata;
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
