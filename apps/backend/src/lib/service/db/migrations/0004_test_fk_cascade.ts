import { type Kysely, sql } from 'kysely';

// Adds a `(testId, fileId, project) -> tests ON DELETE CASCADE` foreign key to
// `test_llm_analyses` and `analysis_feedback` so that deleting a test also removes
// LLM analyses and feedback.
export async function up(db: Kysely<unknown>): Promise<void> {
  // --- test_llm_analyses ---
  await sql`DROP TABLE IF EXISTS test_llm_analyses_new`.execute(db);
  await sql`
    CREATE TABLE test_llm_analyses_new (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      project TEXT NOT NULL,
      reportId TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      analysis TEXT,
      category TEXT,
      model TEXT,
      reusedFromAnalysisId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      inputTokens INTEGER,
      outputTokens INTEGER,
      totalTokens INTEGER,
      UNIQUE(testId, fileId, project, reportId, attempt),
      FOREIGN KEY (reportId) REFERENCES reports(reportID) ON DELETE CASCADE,
      FOREIGN KEY (testId, fileId, project)
        REFERENCES tests(testId, fileId, project) ON DELETE CASCADE
    )
  `.execute(db);
  await sql`
    INSERT INTO test_llm_analyses_new
      SELECT id, testId, fileId, project, reportId, attempt, analysis, category, model,
             reusedFromAnalysisId, createdAt, updatedAt, inputTokens, outputTokens, totalTokens
      FROM test_llm_analyses t
      WHERE EXISTS (
        SELECT 1 FROM tests x
        WHERE x.testId = t.testId AND x.fileId = t.fileId AND x.project = t.project
      )
  `.execute(db);
  await sql`DROP TABLE test_llm_analyses`.execute(db);
  await sql`ALTER TABLE test_llm_analyses_new RENAME TO test_llm_analyses`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tla_test ON test_llm_analyses(testId, fileId, project)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_tla_report ON test_llm_analyses(reportId)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tla_test_report ON test_llm_analyses(testId, reportId)`.execute(
    db
  );

  // --- analysis_feedback ---
  await sql`DROP TABLE IF EXISTS analysis_feedback_new`.execute(db);
  await sql`
    CREATE TABLE analysis_feedback_new (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      project TEXT NOT NULL,
      reportId TEXT,
      errorSignature TEXT,
      comment TEXT NOT NULL CHECK (length(trim(comment)) > 0),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (testId, fileId, project)
        REFERENCES tests(testId, fileId, project) ON DELETE CASCADE
    )
  `.execute(db);
  await sql`
    INSERT INTO analysis_feedback_new
      SELECT id, testId, fileId, project, reportId, errorSignature, comment, createdAt, updatedAt
      FROM analysis_feedback a
      WHERE EXISTS (
        SELECT 1 FROM tests x
        WHERE x.testId = a.testId AND x.fileId = a.fileId AND x.project = a.project
      )
  `.execute(db);
  await sql`DROP TABLE analysis_feedback`.execute(db);
  await sql`ALTER TABLE analysis_feedback_new RENAME TO analysis_feedback`.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_af_test ON analysis_feedback(testId, fileId, project)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_af_updated ON analysis_feedback(updatedAt DESC)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_af_test_lookup ON analysis_feedback(testId, fileId)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_af_signature ON analysis_feedback(errorSignature) WHERE errorSignature IS NOT NULL`.execute(
    db
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // rebuild both tables without the `tests` foreign key (back to the 0001 shape).
  await sql`DROP TABLE IF EXISTS test_llm_analyses_old`.execute(db);
  await sql`
    CREATE TABLE test_llm_analyses_old (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      project TEXT NOT NULL,
      reportId TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      analysis TEXT,
      category TEXT,
      model TEXT,
      reusedFromAnalysisId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      inputTokens INTEGER,
      outputTokens INTEGER,
      totalTokens INTEGER,
      UNIQUE(testId, fileId, project, reportId, attempt),
      FOREIGN KEY (reportId) REFERENCES reports(reportID) ON DELETE CASCADE
    )
  `.execute(db);
  await sql`
    INSERT INTO test_llm_analyses_old
      SELECT id, testId, fileId, project, reportId, attempt, analysis, category, model,
             reusedFromAnalysisId, createdAt, updatedAt, inputTokens, outputTokens, totalTokens
      FROM test_llm_analyses
  `.execute(db);
  await sql`DROP TABLE test_llm_analyses`.execute(db);
  await sql`ALTER TABLE test_llm_analyses_old RENAME TO test_llm_analyses`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tla_test ON test_llm_analyses(testId, fileId, project)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_tla_report ON test_llm_analyses(reportId)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_tla_test_report ON test_llm_analyses(testId, reportId)`.execute(
    db
  );

  await sql`DROP TABLE IF EXISTS analysis_feedback_old`.execute(db);
  await sql`
    CREATE TABLE analysis_feedback_old (
      id TEXT PRIMARY KEY,
      testId TEXT NOT NULL,
      fileId TEXT NOT NULL,
      project TEXT NOT NULL,
      reportId TEXT,
      errorSignature TEXT,
      comment TEXT NOT NULL CHECK (length(trim(comment)) > 0),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `.execute(db);
  await sql`
    INSERT INTO analysis_feedback_old
      SELECT id, testId, fileId, project, reportId, errorSignature, comment, createdAt, updatedAt
      FROM analysis_feedback
  `.execute(db);
  await sql`DROP TABLE analysis_feedback`.execute(db);
  await sql`ALTER TABLE analysis_feedback_old RENAME TO analysis_feedback`.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_af_test ON analysis_feedback(testId, fileId, project)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_af_updated ON analysis_feedback(updatedAt DESC)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_af_test_lookup ON analysis_feedback(testId, fileId)`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_af_signature ON analysis_feedback(errorSignature) WHERE errorSignature IS NOT NULL`.execute(
    db
  );
}
