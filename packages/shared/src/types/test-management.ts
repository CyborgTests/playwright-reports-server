export interface TestWithQuarantineInfo {
  testId: string;
  fileId: string;
  filePath: string;
  project: string;
  title: string;
  createdAt: string;
  isQuarantined?: boolean;
  quarantinedAt?: string;
  quarantineReason?: string;
  flakinessScore?: number;
  flakinessResetAt?: string;
  totalRuns?: number;
  runs?: TestRun[];
  lastRunAt?: string;
  regression?: TestDetailRegression;
  regressionHighlights?: {
    newAtReportId?: string;
    resolvedAtReportId?: string;
  };
}

export type FailureCategorySource = 'heuristic' | 'llm' | 'manual' | 'consensus';

export interface TestRun {
  runId: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  outcome: string;
  duration?: number;
  createdAt: string;
  failureDetails?: string; // JSON string of FailureDetails
  failureCategory?: string;
  failureCategorySource?: FailureCategorySource;
  errorSignature?: string;
  reportTitle?: string;
  reportDisplayNumber?: number;
}

export interface TestDurationStats {
  mean: number;
  median: number;
  p95: number;
  stdDev: number;
  min: number;
  max: number;
}

export interface TestDetailStats {
  totalRuns: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  passRate: number;
  firstRunAt?: string;
  lastRunAt?: string;
  duration?: TestDurationStats;
}

export interface FailureGroupReportRef {
  reportId: string;
  title?: string;
  displayNumber?: number;
}

export interface TestFailureGroup {
  signature: string;
  signatureGlobal?: string;
  category?: string;
  count: number;
  sampleMessage: string;
  firstSeen: string;
  lastSeen: string;
  /** Most recent reports where this signature appeared, newest first. */
  recentReports: FailureGroupReportRef[];
}

export interface TestCrossProjectOccurrence {
  project: string;
  fileId: string;
  totalRuns: number;
  flakinessScore?: number;
  isQuarantined: boolean;
  lastRunAt?: string;
}

export interface TestDetail {
  testId: string;
  fileId: string;
  filePath: string;
  project: string;
  title: string;
  createdAt: string;
  isQuarantined: boolean;
  quarantineReason?: string;
  quarantinedAt?: string;
  flakinessScore?: number;
  flakinessResetAt?: string;
  stats: TestDetailStats;
  runs: TestRun[];
  failureGroups: TestFailureGroup[];
  crossProject: TestCrossProjectOccurrence[];
  regression?: TestDetailRegression;
}

export interface TestDetailRegression {
  regressedAt: string;
  regressedAtCommit?: string;
  lastGreenCommit?: string;
  daysOpen: number;
  failureCount: number;
  flakyCount: number;
}

export type FlakinessTier = 'stable' | 'flaky' | 'critical';
export type TestsSort = 'default' | 'slowest' | 'stale' | 'regression-age';

export interface TestFilters {
  search?: string;
  status?: 'all' | 'quarantined' | 'not-quarantined';
  tiers?: FlakinessTier[];
  sort?: TestsSort;
  project?: string;
  failureCategory?: string;
  regressedOnly?: boolean;
  regressedSince?: string;
  resolvedSince?: string;
}

export interface TestMetrics {
  totalTests: number;
  quarantinedTests: number;
  flakyTests: number;
  avgFlakinessScore: number;
  stableTests: number;
  criticalTests: number;
}

export interface QuarantineUpdateRequest {
  isQuarantined: boolean;
  reason?: string;
}

export interface AutoQuarantineRequest {
  project?: string;
}

export interface QuarantineHistory {
  testId: string;
  fileId: string;
  project: string;
  quarantineEvents: Array<{
    quarantinedAt: string;
    isQuarantined: boolean;
    reason?: string;
    triggeredBy: 'auto' | 'manual';
  }>;
}

export interface TestManagementApiResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
  message?: string;
}
