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
  db.pragma('mmap_size = 33554432');
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = ON');
  db.pragma('auto_vacuum = INCREMENTAL');

  instance[initiatedDb] = db;

  return db;
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
