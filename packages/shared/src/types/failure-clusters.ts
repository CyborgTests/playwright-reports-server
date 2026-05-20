export type ClusterStrategy = 'signature' | 'stack-frame' | 'fixture' | 'temporal';

export type FixturePhase = 'beforeAll' | 'beforeEach' | 'afterAll' | 'afterEach';

export interface ClusterFellowTraveller {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  jointFailureCount: number;
  jointFailureRate: number;
  lastReportId?: string;
  lastReportUrl?: string;
}

export interface ClusterTest {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  occurrences: number;
  lastSeen: string;
  fellowTravellers: ClusterFellowTraveller[];
  /** Most recent reportId where this test failed in the cluster — used to
   *  link to the served Playwright HTML report. */
  lastReportId?: string;
  /** Direct URL to the served Playwright HTML report for `lastReportId`. */
  lastReportUrl?: string;
}

export interface ClusterEvidence {
  signature?: string;
  stackFrame?: string;
  fixturePhase?: FixturePhase;
  coFailureRate?: number;
  secondaryEvidence?: string[];
}

export interface FailureCluster {
  id: string;
  strategy: ClusterStrategy;
  name: string;
  sampleMessage: string;
  category?: string;
  testCount: number;
  failureCount: number;
  estimatedFixes: 1;
  evidence: ClusterEvidence;
  tests: ClusterTest[];
}

export interface ClusterReport {
  clusters: FailureCluster[];
  totalFailures: number;
  windowDays?: number;
  strategiesRun: ClusterStrategy[];
}

export interface ClusterOptions {
  project?: string;
  from?: string;
  to?: string;
  minTests?: number;
  strategies?: ClusterStrategy[];
  reportId?: string;
}
