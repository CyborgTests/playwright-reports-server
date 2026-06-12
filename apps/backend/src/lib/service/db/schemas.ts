export const SITE_CONFIG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS site_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`;

export const NOTIFICATION_STATE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS notification_state (
    channel_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    project TEXT NOT NULL DEFAULT '',
    last_fired_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, rule_id, project)
  );
`;

export const NOTIFICATION_LOG_SCHEMA_SQL = `
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
`;

export const PROJECT_SUMMARY_SCHEMA_SQL = `
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
`;

export const REPORT_RESULTS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS report_results (
    reportId TEXT NOT NULL,
    resultId TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (reportId, resultId),
    FOREIGN KEY (reportId) REFERENCES reports(reportID) ON DELETE CASCADE,
    FOREIGN KEY (resultId) REFERENCES results(resultID) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_report_results_result ON report_results(resultId);
  CREATE INDEX IF NOT EXISTS idx_report_results_report ON report_results(reportId);
`;

export const RESULTS_SCHEMA_SQL = `
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
  CREATE INDEX IF NOT EXISTS idx_results_project ON results(project);
  CREATE INDEX IF NOT EXISTS idx_results_createdAt ON results(createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_results_updatedAt ON results(updatedAt DESC);
  DROP INDEX IF EXISTS idx_results_ids;
`;

export const REPORTS_SCHEMA_SQL = `
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
    files TEXT,
    passRate REAL,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project);
  CREATE INDEX IF NOT EXISTS idx_reports_createdAt ON reports(createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_updatedAt ON reports(updatedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_displayNumber ON reports(displayNumber);
  CREATE INDEX IF NOT EXISTS idx_reports_project_created ON reports(project, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_project_passRate ON reports(project, passRate);
  DROP INDEX IF EXISTS idx_reports_ids;
`;

export const ANALYSIS_FEEDBACK_SCHEMA_SQL = `
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
  CREATE INDEX IF NOT EXISTS idx_af_test_lookup
    ON analysis_feedback(testId, fileId);
  CREATE INDEX IF NOT EXISTS idx_af_signature
    ON analysis_feedback(errorSignature)
    WHERE errorSignature IS NOT NULL;
`;

export const FAILURE_SUMMARY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS report_failure_summaries (
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
  CREATE INDEX IF NOT EXISTS idx_rfs_project ON report_failure_summaries(project);
  CREATE INDEX IF NOT EXISTS idx_rfs_created ON report_failure_summaries(createdAt DESC);
`;

export const TEST_ANALYSIS_SCHEMA_SQL = `
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
    UNIQUE(testId, fileId, project, reportId, attempt),
    FOREIGN KEY (reportId) REFERENCES reports(reportID) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_tla_test ON test_llm_analyses(testId, fileId, project);
  CREATE INDEX IF NOT EXISTS idx_tla_report ON test_llm_analyses(reportId);
  CREATE INDEX IF NOT EXISTS idx_tla_test_report ON test_llm_analyses(testId, reportId);
`;

export const GITHUB_SYNC_SCHEMA_SQL = `
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
`;

export const LLM_TASKS_SCHEMA_SQL = `
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
    isRetry INTEGER NOT NULL DEFAULT 0,
    reportIds TEXT,
    baseUrl TEXT,
    FOREIGN KEY (reportId) REFERENCES reports(reportID) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_llm_tasks_status ON llm_tasks(status, priority DESC, createdAt);
  CREATE INDEX IF NOT EXISTS idx_llm_tasks_report ON llm_tasks(reportId);
  CREATE INDEX IF NOT EXISTS idx_llm_tasks_type ON llm_tasks(type, status);
`;

export const TESTS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tests (
    testId TEXT NOT NULL,
    fileId TEXT NOT NULL,
    filePath TEXT NOT NULL,
    project TEXT NOT NULL,
    title TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    latestRunAt TEXT,
    latestOutcome TEXT,
    latestNonSkippedAt TEXT,
    flakinessScore REAL,
    quarantined INTEGER NOT NULL DEFAULT 0,
    quarantineReason TEXT,
    totalRuns INTEGER NOT NULL DEFAULT 0,
    recentPassRate REAL,
    avgDuration REAL,
    latestFailureCategory TEXT,
    flakinessResetAt TEXT,
    PRIMARY KEY (testId, fileId, project)
  );
  CREATE INDEX IF NOT EXISTS idx_tests_project ON tests(project);
  CREATE INDEX IF NOT EXISTS idx_tests_createdAt ON tests(createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_tests_proj_flakiness
    ON tests(project, flakinessScore DESC);
  CREATE INDEX IF NOT EXISTS idx_tests_proj_lastRunAt
    ON tests(project, latestRunAt DESC);
  CREATE INDEX IF NOT EXISTS idx_tests_proj_avgDuration
    ON tests(project, avgDuration DESC);
  CREATE INDEX IF NOT EXISTS idx_tests_proj_latestFailureCategory
    ON tests(project, latestFailureCategory);

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
    error_signature_global TEXT,
    FOREIGN KEY (testId, fileId, project)
      REFERENCES tests(testId, fileId, project) ON DELETE CASCADE,
    FOREIGN KEY (reportId)
      REFERENCES reports(reportID) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_test_runs_reportId ON test_runs(reportId);
  CREATE INDEX IF NOT EXISTS idx_test_runs_createdAt ON test_runs(createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_test_runs_outcome ON test_runs(outcome);
  CREATE INDEX IF NOT EXISTS idx_test_runs_test_created ON test_runs(testId, project, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_test_runs_outcome_created ON test_runs(outcome, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_test_runs_quarantined_created ON test_runs(quarantined, createdAt DESC);
  DROP INDEX IF EXISTS idx_test_runs_testId;
  DROP INDEX IF EXISTS idx_test_runs_quarantined;
  CREATE INDEX IF NOT EXISTS idx_test_runs_failure_category ON test_runs(failure_category);
  CREATE INDEX IF NOT EXISTS idx_test_runs_error_signature ON test_runs(error_signature);
  CREATE INDEX IF NOT EXISTS idx_test_runs_project_created ON test_runs(project, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_test_runs_test_lane_created
    ON test_runs(testId, fileId, project, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_test_runs_error_signature_global
    ON test_runs(error_signature_global);
`;

export const QUALITY_DASHBOARDS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS quality_dashboards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    isDefault INTEGER NOT NULL DEFAULT 0,
    homeOrder INTEGER NOT NULL DEFAULT 0,
    stalenessDays INTEGER NOT NULL DEFAULT 7,
    defaultGradeBands TEXT NOT NULL,
    defaultFormula TEXT NOT NULL DEFAULT 'lenient',
    defaultMinOkGrade TEXT NOT NULL DEFAULT 'B',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quality_dashboard_nodes (
    id TEXT PRIMARY KEY,
    dashboardId TEXT NOT NULL REFERENCES quality_dashboards(id) ON DELETE CASCADE,
    parentNodeId TEXT REFERENCES quality_dashboard_nodes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('group','project')),
    name TEXT NOT NULL,
    projectName TEXT,
    weight REAL NOT NULL DEFAULT 1,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    gradeBands TEXT,
    formula TEXT,
    minOkGrade TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quality_nodes_dash
    ON quality_dashboard_nodes(dashboardId, parentNodeId, sortOrder);
  CREATE INDEX IF NOT EXISTS idx_quality_nodes_project
    ON quality_dashboard_nodes(dashboardId, projectName);
`;

export const REGRESSIONS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS regressions (
    id TEXT PRIMARY KEY,
    testId TEXT NOT NULL,
    fileId TEXT NOT NULL,
    project TEXT NOT NULL,

    regressedAtReportId TEXT NOT NULL,
    regressedAtCreatedAt TEXT NOT NULL,
    regressedAtCommit TEXT,
    regressedAtCategory TEXT,

    lastGreenReportId TEXT,
    lastGreenCreatedAt TEXT,
    lastGreenCommit TEXT,

    recoveredAtReportId TEXT,
    recoveredAtCreatedAt TEXT,
    recoveredAtCommit TEXT,

    daysOpen REAL,
    failureCount INTEGER NOT NULL DEFAULT 1,
    flakyCount INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (testId, fileId, project)
      REFERENCES tests(testId, fileId, project)
      ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_regressions_open
    ON regressions(recoveredAtReportId, regressedAtCreatedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_regressions_project_open
    ON regressions(project, recoveredAtReportId, regressedAtCreatedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_regressions_test
    ON regressions(testId, fileId, project);
  CREATE INDEX IF NOT EXISTS idx_regressions_commit
    ON regressions(regressedAtCommit);
  CREATE INDEX IF NOT EXISTS idx_regressions_regressedAtReport
    ON regressions(regressedAtReportId);
  CREATE INDEX IF NOT EXISTS idx_regressions_recoveredAtReport
    ON regressions(recoveredAtReportId)
    WHERE recoveredAtReportId IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_regressions_recoveredAt
    ON regressions(recoveredAtCreatedAt)
    WHERE recoveredAtCreatedAt IS NOT NULL;
`;
