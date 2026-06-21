import { type Kysely, sql } from 'kysely';

// A dedicated table of named LLM configurations.
// Exactly one row is the primary model at a time;
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS llm_models (
      id               TEXT PRIMARY KEY,
      label            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      baseUrl          TEXT NOT NULL,
      apiKeyCipher     TEXT,
      model            TEXT NOT NULL,
      parallelRequests INTEGER NOT NULL DEFAULT 1,
      maxTokens        INTEGER,
      contextWindow    INTEGER,
      multimodalMode   TEXT NOT NULL DEFAULT 'auto',
      tier             TEXT,
      inputCostPerMTok  REAL,
      outputCostPerMTok REAL,
      sortOrder        INTEGER NOT NULL DEFAULT 0,
      isActive         INTEGER NOT NULL DEFAULT 0,
      enabled          INTEGER NOT NULL DEFAULT 0,
      lastTestedAt     TEXT,
      lastError        TEXT,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_llm_models_enabled ON llm_models(enabled)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_llm_models_sort ON llm_models(sortOrder)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS llm_models`.execute(db);
}
