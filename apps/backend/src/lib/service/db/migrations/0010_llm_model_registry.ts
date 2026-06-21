import { type Kysely, sql } from 'kysely';

// LLM model registry + per-task multi-strategy routing.
async function hasColumn(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const result = await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(
    db
  );
  return result.rows.some((r) => r.name === column);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS llm_models (
      id                        TEXT PRIMARY KEY,
      label                     TEXT NOT NULL,
      provider                  TEXT NOT NULL,
      baseUrl                   TEXT NOT NULL,
      apiKeyCipher              TEXT,
      model                     TEXT NOT NULL,
      parallelRequests          INTEGER NOT NULL DEFAULT 1,
      maxTokens                 INTEGER,
      contextWindow             INTEGER,
      multimodalMode            TEXT NOT NULL DEFAULT 'auto',
      testAnalysisTemperature   REAL,
      reportSummaryTemperature  REAL,
      projectSummaryTemperature REAL,
      inputCostPerMTok          REAL,
      outputCostPerMTok         REAL,
      sortOrder                 INTEGER NOT NULL DEFAULT 0,
      isPrimary                 INTEGER NOT NULL DEFAULT 0,
      enabled                   INTEGER NOT NULL DEFAULT 0,
      lastTestedAt              TEXT,
      lastError                 TEXT,
      createdAt                 TEXT NOT NULL,
      updatedAt                 TEXT NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_llm_models_enabled ON llm_models(enabled)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_llm_models_sort ON llm_models(sortOrder)`.execute(db);

  if (!(await hasColumn(db, 'llm_tasks', 'parentTaskId'))) {
    await sql`ALTER TABLE llm_tasks ADD COLUMN parentTaskId TEXT`.execute(db);
  }
  if (!(await hasColumn(db, 'llm_tasks', 'role'))) {
    await sql`ALTER TABLE llm_tasks ADD COLUMN role TEXT`.execute(db);
  }
  if (!(await hasColumn(db, 'llm_tasks', 'strategy'))) {
    await sql`ALTER TABLE llm_tasks ADD COLUMN strategy TEXT`.execute(db);
  }
  await sql`CREATE INDEX IF NOT EXISTS idx_llm_tasks_parent ON llm_tasks(parentTaskId)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_llm_tasks_parent`.execute(db);
  if (await hasColumn(db, 'llm_tasks', 'parentTaskId')) {
    await sql`ALTER TABLE llm_tasks DROP COLUMN parentTaskId`.execute(db);
  }
  if (await hasColumn(db, 'llm_tasks', 'role')) {
    await sql`ALTER TABLE llm_tasks DROP COLUMN role`.execute(db);
  }
  if (await hasColumn(db, 'llm_tasks', 'strategy')) {
    await sql`ALTER TABLE llm_tasks DROP COLUMN strategy`.execute(db);
  }
  await sql`DROP TABLE IF EXISTS llm_models`.execute(db);
}
