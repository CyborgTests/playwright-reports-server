import { type ColumnType, Kysely, SqliteDialect } from 'kysely';
import { getDatabase } from './db.js';

type WithDefault<T> = ColumnType<T, T | undefined, T>;

export interface SiteConfigRow {
  id: number;
  config: string;
  updatedAt: string;
}

export interface NotificationStateRow {
  channel_id: string;
  rule_id: string;
  project: string;
  last_fired_at: number;
}

export interface NotificationLogRow {
  id: string;
  channel_id: string;
  channel_type: string;
  rule_id: string;
  rule_kind: string;
  event: string;
  condition: string;
  status: string;
  skip_reason: string | null;
  http_status: number | null;
  error: string | null;
  attempt: number;
  source: string;
  created_at: number;
}

export interface ProjectLlmSummariesRow {
  project: string;
  summary: string;
  structured: string | null;
  model: string | null;
  lastReportId: string | null;
  reportCount: number | null;
  firstReportAt: string | null;
  lastReportAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportResultsRow {
  reportId: string;
  resultId: string;
  createdAt: WithDefault<string>;
}

export interface ResultsRow {
  resultID: string;
  project: string;
  title: string | null;
  createdAt: string;
  size: string | null;
  sizeBytes: number;
  metadata: string;
  updatedAt: WithDefault<string | null>;
}

export interface ReportsRow {
  reportID: string;
  project: string;
  title: string | null;
  displayNumber: number | null;
  createdAt: string;
  reportUrl: string;
  size: string | null;
  sizeBytes: number;
  metadata: string;
  files: string | null;
  passRate: number | null;
  statTotal: number | null;
  statExpected: number | null;
  statUnexpected: number | null;
  statFlaky: number | null;
  statSkipped: number | null;
  durationMs: number | null;
  gitCommitHash: string | null;
  gitCommitShortHash: string | null;
  gitBranch: string | null;
  gitCommitSubject: string | null;
  ciBuildHref: string | null;
  updatedAt: WithDefault<string | null>;
}

export interface AnalysisFeedbackTableRow {
  id: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string | null;
  errorSignature: string | null;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportFailureSummariesRow {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: string;
  llmSummary: string | null;
  llmModel: string | null;
  llmSummaryStructured: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface TestLlmAnalysesRow {
  id: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  attempt: number;
  analysis: string | null;
  category: string | null;
  model: string | null;
  reusedFromAnalysisId: string | null;
  createdAt: string;
  updatedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface GithubSyncConfigsRow {
  id: string;
  name: string;
  enabled: number;
  repo: string;
  workflow: string;
  tokenCipher: string | null;
  startDate: string;
  artifactPattern: string;
  projectTemplate: string;
  titleTemplate: string;
  cronSchedule: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubSyncStateRow {
  artifactId: string;
  syncConfigId: string;
  reportId: string;
  runId: string;
  env: string | null;
  runDate: string | null;
  uploadedAt: string;
}

export interface GithubSyncRunsRow {
  id: string;
  syncConfigId: string;
  status: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  uploaded: number;
  skipped: number;
  failed: number;
  message: string | null;
}

export interface LlmModelsRow {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  apiKeyCipher: string | null;
  model: string;
  parallelRequests: number;
  maxTokens: number | null;
  contextWindow: number | null;
  multimodalMode: string;
  testAnalysisTemperature: number | null;
  reportSummaryTemperature: number | null;
  projectSummaryTemperature: number | null;
  inputCostPerMTok: number | null;
  outputCostPerMTok: number | null;
  sortOrder: number;
  isPrimary: number;
  enabled: number;
  concurrencyGroupId: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LlmConcurrencyGroupsRow {
  id: string;
  name: string;
  concurrencyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface LlmTasksRow {
  id: string;
  type: string;
  status: string;
  priority: number;
  reportId: string | null;
  testId: string | null;
  fileId: string | null;
  project: string | null;
  prompt: string | null;
  result: string | null;
  category: string | null;
  model: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  isRetry: number;
  reportIds: string | null;
  baseUrl: string | null;
  parentTaskId: string | null;
  role: string | null;
  strategy: string | null;
}

export interface TestsRow {
  testId: string;
  fileId: string;
  filePath: string;
  project: string;
  title: string;
  createdAt: string;
  latestRunAt: string | null;
  latestOutcome: string | null;
  latestNonSkippedAt: string | null;
  flakinessScore: number | null;
  quarantined: number;
  quarantineReason: string | null;
  totalRuns: number;
  recentPassRate: number | null;
  avgDuration: number | null;
  latestFailureCategory: string | null;
  flakinessResetAt: string | null;
  quarantineFixedAt: string | null;
}

export interface TestRunsRow {
  runId: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  outcome: string;
  duration: number | null;
  createdAt: string;
  failure_details: Buffer | Uint8Array | string | null;
  failure_category: string | null;
  failure_category_source: string | null;
  error_signature: string | null;
  has_trace: number;
}

export interface TestTraceBaselinesRow {
  testId: string;
  fileId: string;
  project: string;
  sourceReportId: string;
  sourceCreatedAt: string;
  sourceOutcome: string;
  network: string; // JSON-serialized NetworkEvent[]
  dom: string | null; // JSON-serialized normalized DomNode
  updatedAt: string;
}

export interface QualityDashboardsRow {
  id: string;
  name: string;
  slug: string;
  isDefault: number;
  homeOrder: number;
  stalenessDays: number;
  defaultGradeBands: string;
  defaultFormula: string;
  defaultMinOkGrade: string;
  createdAt: string;
  updatedAt: string;
}

export interface QualityDashboardNodesRow {
  id: string;
  dashboardId: string;
  parentNodeId: string | null;
  kind: 'group' | 'project';
  name: string;
  projectName: string | null;
  weight: number;
  sortOrder: number;
  gradeBands: string | null;
  formula: string | null;
  minOkGrade: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegressionsRow {
  id: string;
  testId: string;
  fileId: string;
  project: string;
  regressedAtReportId: string;
  regressedAtCreatedAt: string;
  regressedAtCommit: string | null;
  regressedAtCategory: string | null;
  lastGreenReportId: string | null;
  lastGreenCreatedAt: string | null;
  lastGreenCommit: string | null;
  recoveredAtReportId: string | null;
  recoveredAtCreatedAt: string | null;
  recoveredAtCommit: string | null;
  daysOpen: number | null;
  failureCount: ColumnType<number, number | undefined, number>;
  flakyCount: ColumnType<number, number | undefined, number>;
}

export interface ClusterResolutionsRow {
  clusterId: string;
  project: string | null;
  resolvedAt: string;
  state: 'resolved' | 'active';
  note: string | null;
}

// FTS5 virtual table mirroring tests(title, filePath), maintained by triggers.
// The id columns are UNINDEXED but still selectable, so they belong on the row.
export interface TestsFtsRow {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
}

export interface ReportTagsRow {
  reportId: string;
  key: string;
  value: string;
}

export interface ResultTagsRow {
  resultId: string;
  key: string;
  value: string;
}

export interface UsersRow {
  id: string;
  username: string;
  passwordHash: string | null;
  email: string | null;
  role: 'admin' | 'member' | 'readonly';
  disabled: WithDefault<number>;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  inviteId: string | null;
}

export interface UserIdentitiesRow {
  id: string;
  userId: string;
  provider: 'github' | 'google' | 'oidc';
  externalId: string;
  email: string | null;
  emailVerified: WithDefault<number>;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionsRow {
  id: string;
  tokenHash: string;
  userId: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
}

export interface ApiKeysRow {
  id: string;
  keyHash: string;
  label: string;
  scopes: string; // JSON-serialized scope list, e.g. ["upload","cli"]
  capability: 'read' | 'content';
  ownerUserId: string | null; // null = service key (survives owner deletion)
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface InvitesRow {
  id: string;
  codeHash: string;
  role: 'member' | 'readonly';
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: WithDefault<number>;
  revokedAt: string | null;
}

export interface PasswordResetTokensRow {
  id: string;
  tokenHash: string;
  userId: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface AuthAuditRow {
  id: string;
  ts: string;
  actor: string | null;
  action: string;
  target: string | null;
  detail: string | null;
}

export interface Database {
  api_keys: ApiKeysRow;
  auth_audit: AuthAuditRow;
  cluster_resolutions: ClusterResolutionsRow;
  invites: InvitesRow;
  password_reset_tokens: PasswordResetTokensRow;
  sessions: SessionsRow;
  users: UsersRow;
  user_identities: UserIdentitiesRow;
  regressions: RegressionsRow;
  analysis_feedback: AnalysisFeedbackTableRow;
  github_sync_configs: GithubSyncConfigsRow;
  github_sync_runs: GithubSyncRunsRow;
  github_sync_state: GithubSyncStateRow;
  llm_concurrency_groups: LlmConcurrencyGroupsRow;
  llm_models: LlmModelsRow;
  llm_tasks: LlmTasksRow;
  notification_log: NotificationLogRow;
  notification_state: NotificationStateRow;
  project_llm_summaries: ProjectLlmSummariesRow;
  quality_dashboards: QualityDashboardsRow;
  quality_dashboard_nodes: QualityDashboardNodesRow;
  report_failure_summaries: ReportFailureSummariesRow;
  report_results: ReportResultsRow;
  report_tags: ReportTagsRow;
  reports: ReportsRow;
  result_tags: ResultTagsRow;
  results: ResultsRow;
  site_config: SiteConfigRow;
  test_llm_analyses: TestLlmAnalysesRow;
  test_runs: TestRunsRow;
  test_trace_baselines: TestTraceBaselinesRow;
  tests: TestsRow;
  tests_fts: TestsFtsRow;
}

let kyselyInstance: Kysely<Database> | undefined;

export function getKysely(): Kysely<Database> {
  if (kyselyInstance) return kyselyInstance;

  const db = getDatabase();
  kyselyInstance = new Kysely<Database>({
    dialect: new SqliteDialect({
      database: db,
    }),
  });
  return kyselyInstance;
}
