export interface StatDelta {
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
  newRegressions?: number;
  resolvedRegressions?: number;
}

export interface RegressionTestRef {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
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
  regressions: RegressionsAggregate;
}

export interface RegressionsAggregate {
  active: number;
  newInWindow: number;
  resolvedInWindow: number;
  medianMttrDays: number | null;
  topFiles: Array<{ filePath: string; count: number }>;
  topCommits: Array<{ commit: string; count: number }>;
}

export type ProjectAnalysisVerdict = 'healthy' | 'stabilizing' | 'degrading' | 'failing';

export interface ProjectAnalysisCodeRef {
  kind: 'test' | 'file';
  label: string;
  testId?: string;
  fileId?: string;
  filePath?: string;
  project?: string;
  reportId?: string;
  line?: number;
}

export interface ProjectAnalysisSection {
  heading: string;
  body: string;
  codeRefs?: ProjectAnalysisCodeRef[];
}

export interface ProjectAnalysisStructured {
  verdict: ProjectAnalysisVerdict;
  summary: string;
  sections: ProjectAnalysisSection[];
  latestReportId?: string;
}

export type ReportAnalysisVerdict = 'isolated' | 'clustered' | 'widespread' | 'systemic';

export type ReportAnalysisImpact = 'high' | 'medium' | 'low';

export interface ReportAnalysisCodeRef {
  kind: 'test' | 'file';
  label: string;
  testId?: string;
  fileId?: string;
  filePath?: string;
  project?: string;
  line?: number;
}

export interface ReportAnalysisSection {
  heading: string;
  body: string;
  impact?: ReportAnalysisImpact;
  codeRefs?: ReportAnalysisCodeRef[];
}

export interface ReportAnalysisStructured {
  verdict: ReportAnalysisVerdict;
  summary: string;
  sections: ReportAnalysisSection[];
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
  baseUrl?: string | null;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  maxRetries: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  reportDisplayNumber?: number | null;
  reportTitle?: string | null;
  testTitle?: string | null;
}

export interface LlmTaskStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface LlmUsageTotals {
  tasks: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmUsageByTypeEntry extends LlmUsageTotals {
  type: string;
}

export interface LlmUsageReuse {
  analyses: number;
  reused: number;
  rate: number;
}

export interface LlmUsageStats {
  days: number;
  fromDate: string;
  totals: LlmUsageTotals;
  byType: Record<string, LlmUsageByTypeEntry>;
  reuse: LlmUsageReuse;
}

export interface LlmUsageByModelRow extends LlmUsageTotals {
  baseUrl: string;
  model: string;
}

export interface LlmUsageByModel {
  days: number;
  fromDate: string;
  rows: LlmUsageByModelRow[];
}

export interface LlmDefaultPrompt {
  content: string;
  vars: string[];
}

export interface LlmDefaultPrompts {
  systemPrompt: LlmDefaultPrompt;
  testAnalysisSystemPrompt: LlmDefaultPrompt;
  projectSummarySystemPrompt: LlmDefaultPrompt;
  testAnalysisInstructions: LlmDefaultPrompt;
  reportSummaryPrompt: LlmDefaultPrompt;
  projectSummaryInstructions: LlmDefaultPrompt;
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
