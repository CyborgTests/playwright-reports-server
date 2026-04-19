export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export type LLMProviderType = 'openai' | 'anthropic';

export interface LLMConfig {
  provider?: LLMProviderType;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  parallelRequests?: number;
}

export interface TestManagementConfig {
  quarantineThresholdPercentage?: number;
  warningThresholdPercentage?: number;
  autoQuarantineEnabled?: boolean;
  flakinessMinRuns?: number;
  flakinessEvaluationWindowDays?: number;
}

export type HeaderLinks = Record<string, string>;

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
  faviconPath: string;
  reporterPaths?: string[];
  authRequired?: boolean;
  database?: DatabaseStats;
  dataStorage?: string;
  s3Endpoint?: string;
  s3Bucket?: string;
  cron?: {
    resultExpireDays?: number;
    resultExpireCronSchedule?: string;
    reportExpireDays?: number;
    reportExpireCronSchedule?: string;
  };
  llm?: LLMConfig;
  testManagement?: TestManagementConfig;
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

export interface Result {
  resultID: string;
  project: string;
  title?: string;
  createdAt: string;
  size: string;
  sizeBytes: number;
  stats?: ReportStats;
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
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  total: number;
}

export interface ReadReportsHistory {
  reports: ReportHistory[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  total?: number;
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
  headerLinks?: Record<string, string>;
  logoPath?: string;
  faviconPath?: string;
  reporterPaths?: string[];
  cron?: {
    resultExpireDays?: number;
    resultExpireCronSchedule?: string;
    reportExpireDays?: number;
    reportExpireCronSchedule?: string;
  };
  llm?: LLMConfig;
  testManagement?: TestManagementConfig;
}

export * from './analytics.js';
export * from './test-management.js';
