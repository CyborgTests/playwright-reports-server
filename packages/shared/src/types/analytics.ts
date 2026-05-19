export interface StatDelta {
  /** Percent change vs prior period. Null when prior period had no data. */
  percent: number | null;
  trend: 'up' | 'down' | 'stable';
}

export interface OverviewStats {
  totalTests: number;
  totalRuns: number;
  passRate: number;
  averageTestDuration: number;
  slowestSteps: Array<{ step: string; duration: number; testId: string }>;
  averageTestRunDuration: number;
  passRateTrend: 'up' | 'down' | 'stable';
  flakyTestsTrend: 'up' | 'down' | 'stable';
  /** Per-stat percent deltas vs prior period. */
  deltas?: {
    passRate?: StatDelta;
    flakyTests?: StatDelta;
    averageTestDuration?: StatDelta;
    averageTestRunDuration?: StatDelta;
  };
}

export interface RunHealthMetric {
  runId: string;
  timestamp: Date;
  totalTests: number;
  passed: number;
  failed: number;
  flaky: number;
  duration: number;
}

export interface TrendMetrics {
  durationTrend: Array<{ date: string; duration: number }>;
  flakyCountTrend: Array<{ date: string; count: number }>;
  slowCountTrend: Array<{ date: string; count: number }>;
}

export interface StepTimingTrend {
  stepId: string;
  stepName: string;
  runs: Array<{
    runId: string;
    runDate: Date;
    duration: number;
    isOutlier: boolean;
  }>;
  statistics: {
    mean: number;
    median: number;
    stdDev: number;
    min: number;
    max: number;
    p95: number;
    p99: number;
  };
}

export interface AnalyticsData {
  overviewStats: OverviewStats;
  runHealthMetrics: RunHealthMetric[];
  trendMetrics: TrendMetrics;
}

export type ProjectAnalysisVerdict = 'healthy' | 'stabilizing' | 'degrading' | 'failing';

export interface ProjectAnalysisCodeRef {
  file: string;
  line?: number;
  /** Optional report ID the reference belongs to — lets the UI link to a specific report. */
  reportId?: string;
}

export interface ProjectAnalysisSection {
  heading: string;
  /** Markdown body. */
  body: string;
  /** Code references mentioned in this section. */
  codeRefs?: ProjectAnalysisCodeRef[];
}

export interface ProjectAnalysisStructured {
  verdict: ProjectAnalysisVerdict;
  /** 1–3 sentence executive summary shown above the fold. */
  summary: string;
  sections: ProjectAnalysisSection[];
  /** Latest report ID — used to link code references when their reportId is unset. */
  latestReportId?: string;
}

export type LlmTaskType = 'test_analysis' | 'report_summary' | 'project_summary';
export type LlmTaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface LlmTask {
  id: string;
  type: LlmTaskType;
  status: LlmTaskStatus;
  priority: number;
  reportId?: string;
  testId?: string;
  fileId?: string;
  project?: string;
  prompt?: string;
  result?: string;
  category?: string;
  model?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  maxRetries: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}

export interface LlmTaskStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface FailureDetails {
  message: string;
  stackTrace?: string;
  testTitle: string;
  filePath: string;
  location?: {
    file: string;
    line: number;
    column: number;
  };
  attachments?: Array<{
    name: string;
    path: string;
    contentType: string;
  }>;
  attempt: number;
  status: string;
}

export interface ReportFailureSummary {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: Record<string, number>;
  llmSummary?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TestLlmAnalysis {
  id: string;
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  analysis?: string;
  category?: string;
  model?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface FailureCategoryAnalytics {
  categories: Array<{ category: string; count: number; percentage: number }>;
  totalFailures: number;
  topErrors: Array<{
    message: string;
    category: string;
    count: number;
    signature: string;
    sampleReportId?: string;
    sampleReportUrl?: string;
    sampleTestId?: string;
    affectedTests?: Array<{
      testId: string;
      title: string;
      filePath?: string;
      project: string;
      reportId: string;
      reportUrl?: string;
    }>;
  }>;
}
