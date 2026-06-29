import type { AccessMatrixOverrides, Role } from '../access.js';

export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export interface DateRange {
  from?: string;
  to?: string;
}

export type LLMProviderType = 'openai' | 'anthropic';

export type LLMMultimodalMode = 'auto' | 'force' | 'disabled';

export type LlmTaskType = 'test_analysis' | 'report_summary' | 'project_summary';

export type LlmStrategy = 'one_shot' | 'fusion' | 'council' | 'cascade' | 'self_refine';

export type CascadeGate = 'checks' | 'scorer' | 'checks_and_scorer' | 'disagreement';

export type LlmScreenshotSource = 'attachment' | 'failing_action' | 'series';

export interface LlmRoleRef {
  modelId?: string;
  temperature?: number;
  lens?: string;
}

export interface LlmTaskRouting {
  strategy: LlmStrategy;
  model?: LlmRoleRef;
  authors?: LlmRoleRef[];
  synthesizer?: LlmRoleRef;
  judges?: LlmRoleRef[];
  minPassVotes?: number;
  critic?: LlmRoleRef;
  reviser?: LlmRoleRef;
  maxRounds?: number;
  refineMode?: 'revise' | 'escalate';
  tiers?: LlmRoleRef[];
  scorer?: LlmRoleRef;
  escalateBelowScore?: number;
  cascadeGate?: CascadeGate;
  secondOpinion?: LlmRoleRef;
}

export interface LLMConfig {
  featureEnabled?: boolean;
  configured?: boolean;
  enabled?: boolean;
  primaryModel?: { id: string; label: string; provider: LLMProviderType; model: string } | null;
  useFallbackChain?: boolean;
  routing?: Partial<Record<LlmTaskType, LlmTaskRouting>>;
  screenshotModel?: LlmRoleRef;
  customScreenshotParsePrompt?: string;
  screenshotSources?: LlmScreenshotSource[];
  maxScreenshots?: number;
  autoAnalyzeNewReports?: boolean;
  autoProjectSummaryOnReportComplete?: boolean;
  analyzeGreenWindows?: boolean;
  generalContext?: string;
  customSystemPrompt?: string;
  customTestAnalysisSystemPrompt?: string;
  customProjectSummarySystemPrompt?: string;
  customTestAnalysisInstructions?: string;
  customProjectSummaryInstructions?: string;
  customReportSummaryPrompt?: string;
  customSynthesizerPrompt?: string;
  customJudgePrompt?: string;
  customCritiquePrompt?: string;
  customRevisePrompt?: string;
  customScorerPrompt?: string;
}

export interface LlmModel {
  id: string;
  label: string;
  provider: LLMProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  parallelRequests: number;
  maxTokens?: number;
  contextWindow?: number;
  multimodalMode: LLMMultimodalMode;
  testAnalysisTemperature?: number;
  reportSummaryTemperature?: number;
  projectSummaryTemperature?: number;
  inputCostPerMTok?: number;
  outputCostPerMTok?: number;
  sortOrder: number;
  isPrimary: boolean;
  enabled: boolean;
  concurrencyGroupId?: string | null;
  lastTestedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LlmConcurrencyGroup {
  id: string;
  name: string;
  concurrencyLimit: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestManagementConfig {
  quarantineThresholdPercentage?: number;
  warningThresholdPercentage?: number;
  autoQuarantineEnabled?: boolean;
  flakinessMinRuns?: number;
  flakinessEvaluationWindowDays?: number;
}

export const HEADER_LINK_PRESET_ICONS = [
  'github',
  'telegram',
  'discord',
  'slack',
  'bitbucket',
  'cyborgTest',
] as const;

export type HeaderLinkPresetIcon = (typeof HEADER_LINK_PRESET_ICONS)[number];

export interface HeaderLink {
  id: string;
  label: string;
  url: string;
  icon?: string;
  showLabel?: boolean;
}

export type HeaderLinks = HeaderLink[];

export type IconSvgProps = {
  size?: number;
  width?: number;
  height?: number;
  className?: string;
  [key: string]: unknown;
};

export interface SiteWhiteLabelConfig {
  title: string;
  headerLinks: HeaderLinks;
  logoPath: string;
  logoInvertOnDark?: boolean;
  faviconPath: string;
  serverBaseUrl?: string;
  reporterPaths?: string[];
  authRequired?: boolean;
  allowOpenRegistration?: boolean;
  defaultUserRole?: Role;
  accessMatrix?: AccessMatrixOverrides;
  database?: DatabaseStats;
  dataStorage?: string;
  s3Endpoint?: string;
  s3Bucket?: string;
  azureAccountName?: string;
  azureContainer?: string;
  cron?: {
    resultExpireDays?: number;
    resultExpireCronSchedule?: string;
    reportExpireDays?: number;
    reportExpireCronSchedule?: string;
  };
  llm?: LLMConfig;
  testManagement?: TestManagementConfig;
  notifications?: NotificationsConfig;
  oauth?: OAuthConfig;
  llmUsageResetAt?: string;
}

export const OAUTH_PROVIDER_IDS = ['github', 'google', 'oidc'] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];
export type OAuthProvisioningMode = 'invite_only' | 'open';

export interface OAuthProviderConfig {
  enabled: boolean;
  clientId: string;
  clientSecret?: string;
  mode: OAuthProvisioningMode;
  issuerUrl?: string;
}

export interface OAuthConfig {
  github?: OAuthProviderConfig;
  google?: OAuthProviderConfig;
  oidc?: OAuthProviderConfig;
}

export interface OAuthProviderSettings {
  enabled: boolean;
  clientId: string;
  mode: OAuthProvisioningMode;
  issuerUrl?: string;
  secretSet: boolean;
}
export type OAuthSettings = Record<OAuthProviderId, OAuthProviderSettings>;

export interface OAuthPublicProvider {
  id: OAuthProviderId;
  label: string;
}

export interface DatabaseStats {
  sizeOnDisk: string;
  estimatedRAM: string;
  reports: number;
  results: number;
}

export interface EnvInfo {
  authRequired: boolean;
  database: DatabaseStats;
  dataStorage: string | undefined;
  s3Endpoint: string | undefined;
  s3Bucket: string | undefined;
  azureAccountName: string | undefined;
  azureContainer: string | undefined;
}

export interface Report {
  reportID: string;
  title?: string;
  displayNumber?: number;
  project: string;
  reportUrl: string;
  createdAt: string;
  size: string;
  sizeBytes: number;
}

export interface LinkedReportRef {
  reportID: string;
  displayNumber: number | null;
}

export interface Result {
  resultID: string;
  project: string;
  title?: string;
  createdAt: string;
  size: string;
  sizeBytes: number;
  stats?: ReportStats;
  linkedReports?: LinkedReportRef[];
}

export type ReportTestOutcome =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'flaky'
  | 'expected'
  | 'unexpected';

export enum ReportTestOutcomeEnum {
  Expected = 'expected',
  Unexpected = 'unexpected',
  Flaky = 'flaky',
  Skipped = 'skipped',
  // For frontend compatibility
  Passed = 'passed',
  Failed = 'failed',
}

export interface ReportTest {
  testId: string;
  title: string;
  projectName?: string;
  project?: string;
  location?: {
    file: string;
    line: number;
    column: number;
  };
  duration: number;
  outcome: ReportTestOutcome;
  ok: boolean;
  path?: string[];
  attachments?: Array<{
    name: string;
    path: string;
    contentType: string;
  }>;
  results?: Array<{
    status?: string;
    message?: string;
    attachments?: Array<{
      name: string;
      contentType: string;
      path: string;
    }>;
  }>;
  tags?: string[];
  annotations?: Array<{
    type?: string;
    description?: string;
  }>;
  createdAt?: string;
  // test management fields
  flakinessScore?: number;
  quarantined?: boolean;
  quarantineReason?: string;
}

export interface ReportFile {
  name: string;
  fileId: string;
  fileName: string;
  path: string;
  stats: ReportStats;
  tests: ReportTest[];
}

export interface ReportStats {
  total: number;
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
  ok?: boolean;
}

export interface ReportInfo {
  metadata: ReportMetadata;
  startTime: number;
  duration: number;
  files: ReportFile[];
  projectNames?: string[];
  stats: ReportStats;
}

export interface ReportMetadata {
  actualWorkers: number;
  playwrightVersion?: string;
  [key: string]: unknown; // Allow additional custom fields
}

export interface ReadResultsOutput {
  results: Result[];
  total: number;
}

export interface ReadReportsHistory {
  reports: ReportHistory[];
  total: number;
}

export interface ReportHistory {
  reportID: string;
  title?: string;
  displayNumber?: number;
  project: string;
  reportUrl: string;
  createdAt: string;
  size: string;
  sizeBytes: number;
  stats?: ReportStats;
  files?: ReportFile[];
  duration?: number;
  metadata?: ReportMetadata;
  previousReportId?: string | null;
  regressions?: {
    newHere: number;
    resolvedHere: number;
    newTests?: RegressionTestRef[];
    resolvedTests?: RegressionTestRef[];
  };
}

export interface TestHistory extends ReportTest {
  createdAt: string;
  reportID: string;
  reportUrl: string;
}

export interface ReportTestFilters {
  outcomes?: ReportTestOutcome[];
  name?: string;
}

export interface ServerDataInfo {
  dataFolderSizeinMB: string;
  numOfResults: number;
  resultsFolderSizeinMB: string;
  numOfReports: number;
  reportsFolderSizeinMB: string;
  availableSizeinMB: string;
}

export interface ReportPath {
  reportID: string;
  project?: string;
}

export interface ResultDetails {
  project?: string;
  title?: string;
  testRun?: string;
  playwrightVersion?: string;
  triggerReportGeneration?: string;
  shardCurrent?: string;
  shardTotal?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ReadReportsOutput {
  reports: ReportHistory[];
  total: number;
}

export interface PaginationResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface AuditLogEntry {
  id: string;
  ts: string;
  action: string;
  actor: string | null;
  target: string | null;
  detail: string | null;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
  };
}

export interface ServerConfig {
  title?: string;
  headerLinks?: HeaderLink[];
  logoPath?: string;
  logoInvertOnDark?: boolean;
  faviconPath?: string;
  reporterPaths?: string[];
  serverBaseUrl?: string;
  authRequired?: boolean;
  allowOpenRegistration?: boolean;
  defaultUserRole?: Role;
  accessMatrix?: AccessMatrixOverrides;
  cron?: {
    resultExpireDays?: number;
    resultExpireCronSchedule?: string;
    reportExpireDays?: number;
    reportExpireCronSchedule?: string;
  };
  llm?: LLMConfig;
  testManagement?: TestManagementConfig;
  notifications?: NotificationsConfig;
}

export * from './analytics.js';
export * from './feedback.js';
export * from './github-sync.js';
export * from './notification-defaults.js';
export * from './notification-variables.js';
export * from './notifications.js';
export * from './report-compare.js';
export * from './test-management.js';

import type { RegressionTestRef } from './analytics.js';
import type { NotificationsConfig } from './notifications.js';
