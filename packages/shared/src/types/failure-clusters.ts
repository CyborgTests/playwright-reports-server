export type ClusterStrategy =
  | 'signature'
  | 'stack-frame'
  | 'fixture'
  | 'selector'
  | 'temporal'
  | 'unclustered';

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
  /** Strategies whose evidence placed this test in the cluster. The cluster's
   *  primary strategy is always present; additional entries are added when a
   *  test was independently matched by a folded-in cluster during merge. */
  matchedOn: ClusterStrategy[];
  /** Most recent reportId where this test failed in the cluster — used to
   *  link to the served Playwright HTML report. */
  lastReportId?: string;
  /** Direct URL to the served Playwright HTML report for `lastReportId`. */
  lastReportUrl?: string;
}

export interface SecondaryEvidence {
  strategy: ClusterStrategy;
  count: number;
}

export interface ClusterEvidence {
  signature?: string;
  stackFrame?: string;
  fixturePhase?: FixturePhase;
  selector?: string;
  coFailureRate?: number;
  secondaryEvidence?: SecondaryEvidence[];
}

/** A subsumed cluster preserved on the winner — captured during merge so the
 *  UI can show "N variants grouped" inside the parent card. Doesn't carry its
 *  own tests array (those are already represented in the parent's tests). */
export interface FailureClusterVariant {
  id: string;
  strategy: ClusterStrategy;
  name: string;
  sampleMessage: string;
  testCount: number;
  failureCount: number;
  evidence: ClusterEvidence;
}

export interface FailureCluster {
  id: string;
  strategy: ClusterStrategy;
  name: string;
  sampleMessage: string;
  category?: string;
  testCount: number;
  failureCount: number;
  evidence: ClusterEvidence;
  tests: ClusterTest[];
  /** Clusters from other strategies that overlapped with this one during merge
   *  (≥50% of their tests covered by this cluster). Populated when subsumption
   *  picks the larger cluster as the winner. */
  variants?: FailureClusterVariant[];
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
  includeUnclustered?: boolean;
}
