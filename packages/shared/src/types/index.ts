export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export interface DateRange {
  from?: string;
  to?: string;
}

export type LLMProviderType = 'openai' | 'anthropic';

export type LLMMultimodalMode = 'auto' | 'force' | 'disabled';

export interface LLMConfig {
  provider?: LLMProviderType;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** Per-task temperature. Undefined → fall back to the corresponding entry
   *  in `defaults` (server-side constant). Each task type is set independently. */
  testAnalysisTemperature?: number;
  reportSummaryTemperature?: number;
  projectSummaryTemperature?: number;
  /** Read-only — populated by GET /api/config so the UI can show the active
   *  defaults as input placeholders. Ignored on PATCH (server constants). */
  defaults?: {
    testAnalysisTemperature: number;
    reportSummaryTemperature: number;
    projectSummaryTemperature: number;
  };
  parallelRequests?: number;
  autoAnalyzeNewReports?: boolean;
  autoProjectSummaryOnReportComplete?: boolean;
  /** When true, "Generate Analysis" runs the LLM even for all-green windows
   *  (no failures across the latest N runs) so duration creep / near-flakes /
   *  quarantine churn still get surfaced. When false (default), all-green
   *  windows skip the LLM and return a canned response. */
  analyzeGreenWindows?: boolean;
  maxTokens?: number;
  contextWindow?: number;
  multimodalMode?: LLMMultimodalMode;
  generalContext?: string;
  /** Legacy single system prompt — kept as a fallback for all three tasks so
   *  pre-Phase-3 configs keep working. Per-task overrides below win when set. */
  customSystemPrompt?: string;
  /** Task-specific system prompt overrides. Each falls back to
   *  `customSystemPrompt`, then to the built-in default for its task. */
  customTestAnalysisSystemPrompt?: string;
  customProjectSummarySystemPrompt?: string;
  customTestAnalysisInstructions?: string;
  customProjectSummaryInstructions?: string;
  /** Single override for the report-summary task — combines what used to be
   *  the system prompt + task instructions for this task. The system message
   *  for report-summary is now built-in and not user-overridable. */
  customReportSummaryPrompt?: string;
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
  [key: string]: any;
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
  /** ISO timestamp marking the start of the current LLM usage accounting
   *  window. Set by the "Reset counters" button on the LLM queue page; the
   *  usage-stats queries clamp their lower bound to this value so the user
   *  sees zero immediately while historical rows stay in the database. */
  llmUsageResetAt?: string;
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
  [key: string]: any; // Allow additional custom fields
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

export interface ApiResponse<T = any> {
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
