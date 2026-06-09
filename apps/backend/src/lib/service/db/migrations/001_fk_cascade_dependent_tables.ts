import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

// Retrofits ON DELETE CASCADE foreign-key constraints onto the tables that
// reports.onDeleted() previously cascaded manually.
interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

function fkList(db: Database.Database, table: string): ForeignKeyRow[] {
  return db.pragma(`foreign_key_list('${table}')`) as ForeignKeyRow[];
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return !!row;
}

function hasCascadeFkTo(db: Database.Database, table: string, refTable: string): boolean {
  return fkList(db, table).some(
    (fk) => fk.table === refTable && fk.on_delete.toUpperCase() === 'CASCADE'
  );
}

function recreate(
  db: Database.Database,
  table: string,
  createNewSql: string,
  copyColumns: string,
  postCreateSql: string
): void {
  db.exec(`ALTER TABLE ${table} RENAME TO _${table}_old`);
  db.exec(createNewSql);
  db.exec(`INSERT INTO ${table} (${copyColumns}) SELECT ${copyColumns} FROM _${table}_old`);
  db.exec(`DROP TABLE _${table}_old`);
  db.exec(postCreateSql);
}

function upgradeTestRuns(db: Database.Database): void {
  if (!tableExists(db, 'test_runs')) return;
  if (hasCascadeFkTo(db, 'test_runs', 'tests') && hasCascadeFkTo(db, 'test_runs', 'reports')) {
    return;
  }
  recreate(
    db,
    'test_runs',
    `
      CREATE TABLE test_runs (
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
        error_signature_global TEXT,
        FOREIGN KEY (testId, fileId, project)
          REFERENCES tests(testId, fileId, project) ON DELETE CASCADE,
        FOREIGN KEY (reportId)
          REFERENCES reports(reportID) ON DELETE CASCADE
      );
    `,
    `runId, testId, fileId, project, reportId, outcome, duration, createdAt,
     flakinessScore, quarantineReason, quarantined, fixedAt, failure_details,
     failure_category, failure_category_source, error_signature, error_signature_global`,
    `
      CREATE INDEX IF NOT EXISTS idx_test_runs_reportId ON test_runs(reportId);
      CREATE INDEX IF NOT EXISTS idx_test_runs_createdAt ON test_runs(createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_test_runs_outcome ON test_runs(outcome);
      CREATE INDEX IF NOT EXISTS idx_test_runs_test_created
        ON test_runs(testId, project, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_test_runs_outcome_created
        ON test_runs(outcome, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_test_runs_quarantined_created
        ON test_runs(quarantined, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_test_runs_failure_category
        ON test_runs(failure_category);
      CREATE INDEX IF NOT EXISTS idx_test_runs_error_signature
        ON test_runs(error_signature);
      CREATE INDEX IF NOT EXISTS idx_test_runs_project_created
        ON test_runs(project, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_test_runs_test_lane_created
        ON test_runs(testId, fileId, project, createdAt DESC);
      CREATE INDEX IF NOT EXISTS idx_test_runs_error_signature_global
        ON test_runs(error_signature_global);
    `
  );
}

function upgradeReportFailureSummaries(db: Database.Database): void {
  if (!tableExists(db, 'report_failure_summaries')) return;
  if (hasCascadeFkTo(db, 'report_failure_summaries', 'reports')) return;
  recreate(
    db,
    'report_failure_summaries',
    `
      CREATE TABLE report_failure_summaries (
        reportId TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        totalFailures INTEGER NOT NULL DEFAULT 0,
        categories TEXT NOT NULL DEFAULT '{}',
        llmSummary TEXT,
        llmModel TEXT,
        llmSummaryStructured TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT,
        FOREIGN KEY (reportId) REFERENCES reports(reportID) ON DELETE CASCADE
      );
    `,
    `reportId, project, totalFailures, categories, llmSummary, llmModel,
     llmSummaryStructured, createdAt, updatedAt`,
    `
      CREATE INDEX IF NOT EXISTS idx_rfs_project ON report_failure_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_rfs_created ON report_failure_summaries(createdAt DESC);
    `
  );
}

function upgradeReportResults(db: Database.Database): void {
  if (!tableExists(db, 'report_results')) return;
  if (
    hasCascadeFkTo(db, 'report_results', 'reports') &&
    hasCascadeFkTo(db, 'report_results', 'results')
  ) {
    return;
  }
  recreate(
    db,
    'report_results',
    `
      CREATE TABLE report_results (
        reportId TEXT NOT NULL,
        resultId TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (reportId, resultId),
        FOREIGN KEY (reportId) REFERENCES reports(reportID) ON DELETE CASCADE,
        FOREIGN KEY (resultId) REFERENCES results(resultID) ON DELETE CASCADE
      );
    `,
    `reportId, resultId, createdAt`,
    `
      CREATE INDEX IF NOT EXISTS idx_report_results_result ON report_results(resultId);
      CREATE INDEX IF NOT EXISTS idx_report_results_report ON report_results(reportId);
    `
  );
}

function upgradeTestLlmAnalyses(db: Database.Database): void {
  if (!tableExists(db, 'test_llm_analyses')) return;
  if (hasCascadeFkTo(db, 'test_llm_analyses', 'reports')) return;
  recreate(
    db,
    'test_llm_analyses',
    `
      CREATE TABLE test_llm_analyses (
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
      );
    `,
    `id, testId, fileId, project, reportId, attempt, analysis, category, model,
     reusedFromAnalysisId, createdAt, updatedAt, inputTokens, outputTokens, totalTokens`,
    `
      CREATE INDEX IF NOT EXISTS idx_tla_test ON test_llm_analyses(testId, fileId, project);
      CREATE INDEX IF NOT EXISTS idx_tla_report ON test_llm_analyses(reportId);
      CREATE INDEX IF NOT EXISTS idx_tla_test_report ON test_llm_analyses(testId, reportId);
    `
  );
}

function upgradeLlmTasks(db: Database.Database): void {
  if (!tableExists(db, 'llm_tasks')) return;
  if (hasCascadeFkTo(db, 'llm_tasks', 'reports')) return;
  recreate(
    db,
    'llm_tasks',
    `
      CREATE TABLE llm_tasks (
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
        isRetry INTEGER NOT NULL DEFAULT 0,
        reportIds TEXT,
        baseUrl TEXT,
        FOREIGN KEY (reportId) REFERENCES reports(reportID) ON DELETE CASCADE
      );
    `,
    `id, type, status, priority, reportId, testId, fileId, project, prompt, result,
     category, model, error, createdAt, startedAt, completedAt, retryCount,
     maxRetries, inputTokens, outputTokens, totalTokens, isRetry, reportIds, baseUrl`,
    `
      CREATE INDEX IF NOT EXISTS idx_llm_tasks_status
        ON llm_tasks(status, priority DESC, createdAt);
      CREATE INDEX IF NOT EXISTS idx_llm_tasks_report ON llm_tasks(reportId);
      CREATE INDEX IF NOT EXISTS idx_llm_tasks_type ON llm_tasks(type, status);
    `
  );
}

export const migration001FkCascade: Migration = {
  id: '001_fk_cascade_dependent_tables',
  description: 'Retrofit ON DELETE CASCADE on dependents of reports/results/tests',
  up: (db: Database.Database) => {
    upgradeTestRuns(db);
    upgradeReportFailureSummaries(db);
    upgradeReportResults(db);
    upgradeTestLlmAnalyses(db);
    upgradeLlmTasks(db);
  },
};
