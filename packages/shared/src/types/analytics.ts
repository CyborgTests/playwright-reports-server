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
  title?: string;
  displayNumber?: number;
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

export interface TestsSummary {
  total: number;
  flakyCount: number;
}

export interface AnalyticsData {
  overviewStats: OverviewStats;
  runHealthMetrics: RunHealthMetric[];
  trendMetrics: TrendMetrics;
  testsSummary: TestsSummary;
  failureCategories: FailureCategoryAnalytics;
}

export type ProjectAnalysisVerdict = 'healthy' | 'stabilizing' | 'degrading' | 'failing';

export interface ProjectAnalysisCodeRef {
  /** Discriminator: 'test' links to /test/:fileId/:testId; 'file' opens the report viewer. */
  kind: 'test' | 'file';
  /** Display label (e.g., test title or file path). */
  label: string;
  /** Required when kind='test'. */
  testId?: string;
  /** Required when kind='test'; optional when kind='file'. */
  fileId?: string;
  /** Required when kind='file'; optional when kind='test'. */
  filePath?: string;
  /** Project the test/file belongs to. Injected server-side so the test
   *  detail page can build its `?project=…` query. Not asked of the model. */
  project?: string;
  /** Optional report ID the reference belongs to — lets the UI link to a specific report. */
  reportId?: string;
  /** Optional 1-based line number. */
  line?: number;
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

export type ReportAnalysisVerdict = 'isolated' | 'clustered' | 'widespread' | 'systemic';

export type ReportAnalysisImpact = 'high' | 'medium' | 'low';

export interface ReportAnalysisCodeRef {
  /** Discriminator: 'test' links to /test/:fileId/:testId; 'file' opens the report viewer. */
  kind: 'test' | 'file';
  /** Display label (e.g., test title or file path). */
  label: string;
  /** Required when kind='test'. */
  testId?: string;
  /** Required when kind='test'; optional when kind='file'. */
  fileId?: string;
  /** Required when kind='file'; optional when kind='test'. */
  filePath?: string;
  /** Project the test/file belongs to. Injected server-side from the report's
   *  project so the UI can build the `?project=…` query the test detail page
   *  uses to scope its lookup. Not asked of the model. */
  project?: string;
  /** Optional 1-based line number. */
  line?: number;
}

export interface ReportAnalysisSection {
  heading: string;
  /** Markdown body. */
  body: string;
  /** Optional severity tag rendered as a pill next to the heading. */
  impact?: ReportAnalysisImpact;
  /** Code references mentioned in this section. */
  codeRefs?: ReportAnalysisCodeRef[];
}

export interface ReportAnalysisStructured {
  verdict: ReportAnalysisVerdict;
  /** 1–3 sentence executive summary shown above the fold. */
  summary: string;
  sections: ReportAnalysisSection[];
  /** Report ID this analysis belongs to — used by the UI to scope codeRefs. */
  reportId?: string;
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
  /** Structured LLM analysis (verdict + sections + codeRefs). Null when the
   *  text-parse fallback couldn't recover structure from a plain-markdown
   *  response — the UI falls back to rendering `llmSummary` as markdown. */
  llmSummaryStructured?: ReportAnalysisStructured | null;
  llmModel?: string | null;
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
