import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'database.sqlite'));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    project TEXT,
    testRunName TEXT,
    reporter TEXT,
    size INTEGER,
    createdAt TEXT,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    project TEXT,
    size INTEGER,
    createdAt TEXT,
    reportUrl TEXT,
    metadata TEXT,
    resultIds TEXT
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migration: add resultIds to reports if missing (existing DBs created before this column)
try {
  const tableInfo = db.prepare("PRAGMA table_info(reports)").all() as { name: string }[];
  if (tableInfo && !tableInfo.some((c) => c.name === 'resultIds')) {
    db.exec('ALTER TABLE reports ADD COLUMN resultIds TEXT');
  }
} catch {
  // ignore
}

// Migration: add stats columns to reports
const statsColumns = ['statsTotal', 'statsExpected', 'statsUnexpected', 'statsFlaky', 'statsSkipped'] as const;
try {
  const tableInfo = db.prepare("PRAGMA table_info(reports)").all() as { name: string }[];
  const existing = new Set(tableInfo.map((c) => c.name));
  for (const col of statsColumns) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE reports ADD COLUMN ${col} INTEGER`);
    }
  }
} catch {
  // ignore
}

export default db;
