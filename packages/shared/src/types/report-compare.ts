import type { ReportStats } from './index.js';

export type DiffOutcome = 'pass' | 'fail' | 'flaky' | 'skipped' | 'unknown';

export interface CompareReportRef {
  reportID: string;
  title?: string;
  displayNumber?: number;
  project: string;
  createdAt: string;
  reportUrl: string;
  stats?: ReportStats;
}

export interface DiffTestEntry {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  outcomeA?: DiffOutcome;
  outcomeB?: DiffOutcome;
  rawOutcomeA?: string;
  rawOutcomeB?: string;
  durationA?: number;
  durationB?: number;
}

export interface DurationDeltaEntry extends DiffTestEntry {
  durationA: number;
  durationB: number;
  deltaMs: number;
  deltaPct: number;
}

export interface ReportCompareSummary {
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
}

export interface ReportCompareResponse {
  reportA: CompareReportRef;
  reportB: CompareReportRef;
  summary: ReportCompareSummary;
  newlyFailed: DiffTestEntry[];
  fixed: DiffTestEntry[];
  stillFailing: DiffTestEntry[];
  flakyToPass: DiffTestEntry[];
  passToFlaky: DiffTestEntry[];
  newTests: DiffTestEntry[];
  removedTests: DiffTestEntry[];
  durationDeltas: DurationDeltaEntry[];
}
