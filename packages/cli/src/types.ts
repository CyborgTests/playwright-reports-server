/**
 * Wire-format types for the subset of API responses the CLI consumes.
 * Kept here rather than imported from `@playwright-reports/shared` so the CLI
 * has no workspace dependency - it speaks HTTP, not types.
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

export type NormalizedOutcome = 'passed' | 'failed' | 'flaky' | 'skipped';

export interface TestBrief {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  signals: {
    quarantined: boolean;
    flakinessScore: number;
    flakyTier: 'stable' | 'flaky' | 'critical';
    /** Count of prior runs sharing the same `latestFailure.signature`. */
    signatureOccurrenceCount: number;
    /** Timestamp this `signature` first appeared (not the test's first run). */
    signatureFirstSeen?: string;
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
    attachments?: {
      screenshotUrl?: string;
      errorContextUrl?: string;
    };
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
    kind: ClusterAnchorKind;
    name: string;
    sampleError: string;
    otherTests: Array<{ testId: string; fileId: string; project: string; title: string }>;
    otherTestsTotal: number;
    otherTestsTruncated: boolean;
  } | null;
  regression: {
    id: string;
    regressedAtReportId: string;
    regressedAtDisplayNumber: number | null;
    regressedAtCreatedAt: string;
    regressedAtCommit: string | null;
    regressedAtCategory: string | null;
    lastGreenReportId: string | null;
    lastGreenDisplayNumber: number | null;
    lastGreenCreatedAt: string | null;
    lastGreenCommit: string | null;
    daysOpen: number;
    failureCount: number;
    flakyCount: number;
  } | null;
}

export interface ReportBriefSummaryEntry {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  category?: string;
  errorFirstLine?: string;
}

export interface ReportBriefCluster {
  id: string;
  kind: ClusterAnchorKind;
  name: string;
  sampleError: string;
  testCount: number;
  testIds: string[];
  /** Top-N representative failures in this cluster, always populated. */
  sampleFailedTests: ReportBriefSummaryEntry[];
}

interface ReportBriefBase {
  reportId: string;
  displayNumber?: number;
  title?: string;
  project: string;
  createdAt: string;
  reportUrl: string;
  stats: { total: number; passed: number; failed: number; flaky: number; skipped: number };
  clusterSummary: ReportBriefCluster[];
  unclusteredFailures: number;
  failedTestsTruncated: boolean;
  regressions: { newHere: number; resolvedHere: number } | null;
  runContext?: {
    gitCommit?: { hash?: string; shortHash?: string; branch?: string; subject?: string };
    ciBuild?: { buildHref?: string; commitHref?: string; commitHash?: string };
    appCommit?: string;
    appVersion?: string;
    releaseVersion?: string;
    deployedSha?: string;
  };
}

/** Discriminated by `mode` - agents can statically pick the right arm. */
export type ReportBrief =
  | (ReportBriefBase & {
      mode: 'summary';
      sampleUnclusteredFailures: ReportBriefSummaryEntry[];
    })
  | (ReportBriefBase & {
      mode: 'full';
      failedTests: TestBrief[];
    });

export interface TestHistoryRun {
  reportId: string;
  reportDisplayNumber?: number;
  reportTitle?: string;
  outcome: NormalizedOutcome;
  durationMs?: number;
  errorSignature?: string;
  category?: string;
  createdAt: string;
}

export interface TestHistory {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  totalReturned: number;
  appliedLimit: number;
  limitClamped: boolean;
  hasMore: boolean;
  stats: { runs: number; passed: number; failed: number; flaky: number; skipped: number };
  signatureGroups: Array<{
    signature: string;
    category?: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
  }>;
  runs: TestHistoryRun[];
}

export interface TestSignatureHistory {
  priorOccurrenceCount: number;
  firstOccurrence: {
    reportId: string;
    createdAt: string;
    displayNumber: number | null;
    title: string | null;
  } | null;
}

export interface RelatedFeedbackEntry {
  project: string;
  feedback: {
    id: string;
    testId?: string;
    fileId?: string;
    project: string;
    reportId?: string;
    errorSignature?: string;
    comment: string;
    createdAt: string;
    updatedAt: string;
  };
  latestAnalysis?: {
    analysis: string;
    updatedAt: string;
    model?: string;
  };
  errorSignatureMatchesCurrent: boolean;
}

export type ClusterAnchorKind = 'fixture' | 'selector' | 'frame' | 'signature' | 'unmatched';

export type ClusterAnchor =
  | { kind: 'fixture'; verb: string; phase: string; filePath: string }
  | { kind: 'selector'; verb: string; selector: string }
  | { kind: 'frame'; verb: string; frame: string }
  | { kind: 'signature'; verb: string; signature: string }
  | { kind: 'unmatched'; testId: string; fileId: string; project: string };

export interface ClusterRegressionContext {
  membersInRegression: number;
  totalMembers: number;
  sharedRegressionCommit: string | null;
  earliestRegression: string | null;
}

export interface ClusterBriefResponse {
  cluster: {
    id: string;
    kind: ClusterAnchorKind;
    name: string;
    sampleError: string;
    category?: string;
    confidence: 'high' | 'medium' | 'low';
    testCount: number;
    failureCount: number;
    anchor: ClusterAnchor;
  };
  members: TestBrief[];
  membersTruncated: boolean;
  regressionContext: ClusterRegressionContext | null;
}

/** Mirrors the backend FailureSummaryRow shape (`failureSummary.sqlite.ts`). */
export interface FailureSummaryRow {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: Record<string, number>;
  llmSummary: string | null;
  llmModel: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface ReportSummary {
  reportId: string;
  project: string;
  displayNumber?: number;
  hasFailures: boolean;
  /** Null when no failure summary has been generated for this report yet. */
  summary: FailureSummaryRow | null;
}

export interface ProjectSummary {
  project: string;
  summary: {
    summary: string;
    structured: unknown;
    model: string | null;
    lastReportId: string | null;
    reportCount: number;
    firstReportAt: string | null;
    lastReportAt: string | null;
    updatedAt: string;
  } | null;
}

export interface FailureCategoriesResponse {
  project: string | null;
  categories: Array<{ category: string; occurrences: number }>;
}

export interface TestAnalysis {
  testId: string;
  fileId: string;
  project: string;
  analysis: string | null;
  model: string | null;
  category: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReportResolveResponse {
  displayNumber: number;
  project: string | null;
  matches: Array<{
    reportId: string;
    project: string;
    title?: string;
    displayNumber: number;
    createdAt: string;
    reportUrl: string;
  }>;
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
    deltas?: Record<
      string,
      { percent: number | null; trend: 'up' | 'down' | 'stable' } | undefined
    >;
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
  regressions: {
    active: number;
    newInWindow: number;
    closedInWindow: number;
    medianMttrDays: number | null;
    topFiles: Array<{ filePath: string; count: number }>;
    topCommits: Array<{ commit: string; count: number }>;
  };
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

export type ClusterLifecycle = 'active' | 'resolved' | 'unattributed';

export interface ClusterResolution {
  resolvedAt: string;
  note?: string;
  manual: boolean;
}

export interface FailureCluster {
  id: string;
  anchor: ClusterAnchor;
  name: string;
  sampleMessage: string;
  category?: string;
  confidence: 'high' | 'medium' | 'low';
  testCount: number;
  failureCount: number;
  tests: ClusterTest[];
  lifecycle?: ClusterLifecycle;
  resolution?: ClusterResolution;
}

export interface ClusterReport {
  clusters: FailureCluster[];
  totalFailures: number;
  windowDays?: number;
}

export type DiffOutcome = 'passed' | 'failed' | 'flaky' | 'skipped' | 'unknown';

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
