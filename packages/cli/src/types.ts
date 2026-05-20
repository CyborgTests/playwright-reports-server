/**
 * Wire-format types for the subset of API responses the CLI consumes.
 * Kept here rather than imported from `@playwright-reports/shared` so the CLI
 * has no workspace dependency — it speaks HTTP, not types.
 */

export interface TestSummary {
  testId: string;
  fileId: string;
  filePath: string;
  project: string;
  title: string;
  isQuarantined?: boolean;
  flakinessScore?: number;
  totalRuns?: number;
  lastRunAt?: string;
}

export interface FailureLocation {
  file: string;
  line: number;
  column?: number;
}

export interface TestBrief {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  signals: {
    quarantined: boolean;
    flakinessScore: number;
    occurrenceCount: number;
    firstSeen?: string;
    isClustered: boolean;
  };
  latestFailure: {
    error: string;
    category?: string;
    signature?: string;
    location?: FailureLocation;
    appFrame?: string;
    reportId: string;
    reportUrl?: string;
    createdAt: string;
  } | null;
  llmAnalysis: {
    rootCause: string;
    fix: string;
    model?: string;
  } | null;
  feedback: {
    comment: string;
    updatedAt: string;
  } | null;
  cluster: {
    id: string;
    strategy: string;
    name: string;
    sampleError: string;
    otherTests: Array<{ testId: string; fileId: string; project: string; title: string }>;
  } | null;
}

export interface ReportBrief {
  reportId: string;
  displayNumber?: number;
  title?: string;
  project: string;
  createdAt: string;
  reportUrl: string;
  stats: { total: number; passed: number; failed: number; flaky: number; skipped: number };
  clusterSummary: Array<{
    id: string;
    strategy: string;
    name: string;
    sampleError: string;
    testCount: number;
    testIds: string[];
  }>;
  unclusteredFailures: number;
  failedTestsTruncated: boolean;
  failedTests: TestBrief[];
}

export interface ReportStats {
  total: number;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  ok: boolean;
}

export interface ReportListRow {
  reportID: string;
  project: string;
  title?: string;
  displayNumber?: number;
  createdAt: string;
  reportUrl?: string;
  sizeBytes?: number;
  stats?: ReportStats;
}

export interface ReportListResponse {
  reports: ReportListRow[];
  total: number;
}

export interface AnalyticsResponse {
  overviewStats: {
    totalTests: number;
    totalRuns: number;
    passRate: number;
    averageTestDuration: number;
    averageTestRunDuration: number;
    passRateTrend?: 'up' | 'down' | 'stable';
    flakyTestsTrend?: 'up' | 'down' | 'stable';
    deltas?: Record<string, { percent: number | null; trend: 'up' | 'down' | 'stable' } | undefined>;
  };
  runHealthMetrics: Array<{
    runId: string;
    timestamp: string;
    totalTests: number;
    passed: number;
    failed: number;
    flaky: number;
    duration: number;
    displayNumber?: number;
    title?: string;
  }>;
  trendMetrics: {
    durationTrend: Array<{ date: string; duration: number }>;
    flakyCountTrend: Array<{ date: string; count: number }>;
    slowCountTrend: Array<{ date: string; count: number }>;
  };
  testsSummary: { total: number; flakyCount: number };
  failureCategories: unknown;
}

export interface ClusterTest {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  occurrences: number;
  lastSeen: string;
  lastReportId?: string;
  lastReportUrl?: string;
}

export interface FailureCluster {
  id: string;
  strategy: 'signature' | 'stack-frame' | 'fixture' | 'temporal';
  name: string;
  sampleMessage: string;
  category?: string;
  testCount: number;
  failureCount: number;
  evidence: {
    signature?: string;
    stackFrame?: string;
    fixturePhase?: string;
    coFailureRate?: number;
    secondaryEvidence?: string[];
  };
  tests: ClusterTest[];
}

export interface ClusterReport {
  clusters: FailureCluster[];
  totalFailures: number;
  windowDays?: number;
  strategiesRun: string[];
}

export type DiffOutcome = 'pass' | 'fail' | 'flaky' | 'skipped' | 'unknown';

export interface DiffTestEntry {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  outcomeA?: DiffOutcome;
  outcomeB?: DiffOutcome;
  durationA?: number;
  durationB?: number;
}

export interface DurationDeltaEntry extends DiffTestEntry {
  durationA: number;
  durationB: number;
  deltaMs: number;
  deltaPct: number;
}

export interface ReportCompareResponse {
  reportA: {
    reportID: string;
    title?: string;
    displayNumber?: number;
    project: string;
    createdAt: string;
    reportUrl: string;
    stats?: ReportStats;
  };
  reportB: {
    reportID: string;
    title?: string;
    displayNumber?: number;
    project: string;
    createdAt: string;
    reportUrl: string;
    stats?: ReportStats;
  };
  summary: {
    totalA: number;
    totalB: number;
    newlyFailedCount: number;
    fixedCount: number;
    stillFailingCount: number;
    flakyToPassCount: number;
    passToFlakyCount: number;
    newTestsCount: number;
    removedTestsCount: number;
    durationRegressionsCount: number;
    durationImprovementsCount: number;
  };
  newlyFailed: DiffTestEntry[];
  fixed: DiffTestEntry[];
  stillFailing: DiffTestEntry[];
  flakyToPass: DiffTestEntry[];
  passToFlaky: DiffTestEntry[];
  newTests: DiffTestEntry[];
  removedTests: DiffTestEntry[];
  durationDeltas: DurationDeltaEntry[];
}
