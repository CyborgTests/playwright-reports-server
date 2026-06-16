export type { AnalysisFeedbackRow } from './analysisFeedback.sqlite.js';
export { analysisFeedbackDb } from './analysisFeedback.sqlite.js';
export type {
  ClusterOverrideState,
  ClusterResolutionRow,
} from './clusterResolutions.sqlite.js';
export { clusterResolutionsDb } from './clusterResolutions.sqlite.js';
export {
  clearAll,
  closeDatabase,
  createDatabase,
  getDatabase,
  getDatabaseStats,
  optimizeDB,
} from './db.js';
export type { FailureSummaryRow } from './failureSummary.sqlite.js';
export { failureSummaryDb } from './failureSummary.sqlite.js';
export type {
  GithubSyncConfigRow,
  GithubSyncRunRow,
  GithubSyncStateRow,
} from './githubSync.sqlite.js';
export { githubSyncDb } from './githubSync.sqlite.js';
export type {
  LlmTaskRow,
  LlmTaskRowEnriched,
  LlmTaskStatus,
  LlmTaskType,
  LlmTaskUsage,
} from './llmTasks.sqlite.js';
export { llmTasksDb } from './llmTasks.sqlite.js';
export type { NotificationLogQueryFilters } from './notificationLog.sqlite.js';
export { notificationLogDb } from './notificationLog.sqlite.js';
export { notificationStateDb } from './notificationState.sqlite.js';
export type { ProjectSummaryRow } from './projectSummary.sqlite.js';
export { projectSummaryDb } from './projectSummary.sqlite.js';
export type {
  DashboardCreateInput,
  DashboardUpdateInput,
} from './qualityDashboards.sqlite.js';
export { DashboardNameConflictError, qualityDashboardsDb } from './qualityDashboards.sqlite.js';
export type { UsageByModel, UsageReuse, UsageTotals } from './queries/llmUsage.js';

export { getUsageByModel, getUsageStats } from './queries/llmUsage.js';
export { computeProjectCoverageScope } from './queries/projectCoverage.js';
export type {
  ListFilters as RegressionListFilters,
  RegressionListItem,
  RegressionRow,
  RegressionSummary,
} from './regressions.sqlite.js';
export { regressionsDb, toRegressionContext } from './regressions.sqlite.js';
export { reportResultsDb } from './reportResults.sqlite.js';
export type { ReportHistoryLite } from './reports.sqlite.js';
export { reportDb } from './reports.sqlite.js';
export { resultDb } from './results.sqlite.js';
export { siteConfigDb } from './siteConfig.sqlite.js';
export type { TestAnalysisExtras, TestAnalysisRow } from './testAnalysis.sqlite.js';
export { testAnalysisDb } from './testAnalysis.sqlite.js';
export type { Test, TestRunRow, TestWithQuarantineInfoRow } from './tests.sqlite.js';
export { testDb } from './tests.sqlite.js';
