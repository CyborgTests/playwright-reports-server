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
  totalRuns?: number;
  runs?: TestRun[];
  lastRunAt?: string;
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
  quarantineReason?: string;
  quarantined?: boolean;
  flakinessScore?: number;
  failureDetails?: string; // JSON string of FailureDetails
  failureCategory?: string;
  failureCategorySource?: FailureCategorySource;
  errorSignature?: string;
  reportTitle?: string;
  reportDisplayNumber?: number;
}

export interface TestDetailInfo {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  createdAt: string;
  runs: TestRun[];
  isQuarantined?: boolean;
  quarantinedAt?: string;
  quarantineReason?: string;
  flakinessScore?: number;
  totalRuns?: number;
  lastRunAt?: string;
}

export interface TestFilters {
  search?: string;
  status?: 'all' | 'quarantined' | 'not-quarantined';
  flakinessMin?: number;
  flakinessMax?: number;
  project?: string;
  failureCategory?: string;
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

export interface TestManagementApiResponse<T = any> {
  success: boolean;
  data: T;
  error?: string;
  message?: string;
}
