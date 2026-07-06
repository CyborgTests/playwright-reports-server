/**
 * Failure-clustering types.
 *
 * Each failed Playwright test_run is assigned to exactly one cluster via a
 * deterministic anchor. Two failures share a cluster iff their anchors are
 * equal. There is no merging, no precedence resolution, no temporal/signature
 * grouping - the anchor IS the cluster. This produces:
 *  - Stable cluster IDs across calls (id = hash(anchor)).
 *  - "One cluster = one fix" semantics by construction.
 *  - A small, named set of cluster kinds the LLM/UI can branch on.
 */

export type FixturePhase = 'beforeAll' | 'beforeEach' | 'afterAll' | 'afterEach';

export const PLAYWRIGHT_VERBS = [
  // Locator assertions
  'toBeVisible',
  'toBeHidden',
  'toBeAttached',
  'toBeEnabled',
  'toBeDisabled',
  'toBeChecked',
  'toBeEmpty',
  'toBeFocused',
  'toHaveText',
  'toHaveValue',
  'toHaveCount',
  'toHaveAttribute',
  'toHaveClass',
  'toContainText',
  // Page assertions
  'toHaveURL',
  'toHaveTitle',
  // Value assertions
  'toBe',
  'toEqual',
  'toMatch',
  'toMatchObject',
  'toContain',
  'toBeTruthy',
  'toBeFalsy',
  // Locator actions
  'click',
  'fill',
  'press',
  'type',
  'check',
  'uncheck',
  'hover',
  'focus',
  'blur',
  'selectOption',
  'setInputFiles',
  'dragTo',
  'screenshot',
  'waitFor',
  // Page actions
  'goto',
  'reload',
  'waitForURL',
  'waitForSelector',
  'waitForLoadState',
] as const;

export type PlaywrightVerb =
  | (typeof PLAYWRIGHT_VERBS)[number]
  // Strict-mode violation isn't a verb but a class of failure; tagged
  // explicitly because the fix is selector-disambiguation.
  | 'strictModeViolation'
  // Bare `Test timeout of Nms exceeded.` with no verb context.
  | 'testTimeout'
  // Couldn't classify - anchor falls back to test identity.
  | 'unknown';

/**
 * The anchor uniquely identifies a cluster. Discriminated union by `kind`.
 * Priority during classification: fixture > selector > frame > signature > unmatched.
 */
export type ClusterAnchor =
  | { kind: 'fixture'; verb: PlaywrightVerb; phase: FixturePhase; filePath: string }
  | { kind: 'selector'; verb: PlaywrightVerb; selector: string }
  | { kind: 'frame'; verb: PlaywrightVerb; frame: string }
  | { kind: 'signature'; verb: PlaywrightVerb; signature: string }
  | {
      kind: 'unmatched';
      testId: string;
      fileId: string;
      project: string;
    };

export type ClusterAnchorKind = ClusterAnchor['kind'];

export type ClusterConfidence = 'high' | 'medium' | 'low';

export const CLUSTER_KIND_LABELS: Record<ClusterAnchorKind, string> = {
  fixture: 'Fixture',
  selector: 'Selector',
  frame: 'Frame',
  signature: 'Signature',
  unmatched: 'Unmatched',
};

export const CLUSTER_KIND_DESCRIPTIONS: Record<ClusterAnchorKind, string> = {
  fixture:
    'Failure cascaded from a beforeAll/beforeEach/afterAll/afterEach hook. Fix the hook once and every member test passes.',
  selector:
    'Tests share a failing Playwright locator (aria-label, role, css). Typically one UI element drift breaking N tests across files.',
  frame:
    'Tests crash at the same line of app code. The frame is the literal fix location (file:line).',
  signature:
    "Tests share a normalized error signature but no extractable fixture/selector/frame anchor. Either a global (server/network/browser-infra) failure clustered across files, or a deep-stack pattern (timeouts, framework errors) the extractors can't pin to a single line.",
  unmatched:
    'No extractable fix mechanism - the failure shape is unique to the test. Anchored to test identity so repeated failures of the same test still group together.',
};

export const CLUSTER_CONFIDENCE_LABELS: Record<ClusterConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export const CLUSTER_CONFIDENCE_DESCRIPTIONS: Record<ClusterConfidence, string> = {
  high: 'Strong evidence that one fix resolves every member test (fixture, or ≥ 3 tests share a frame/selector anchor).',
  medium:
    'Reasonable evidence (2 tests share an anchor, or one test fails chronically at the same anchor).',
  low: 'Single-test single-failure, or no extractable mechanism. Treat as a starting point, not a verdict.',
};

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
  anchor: ClusterAnchor;
  name: string;
  sampleMessage: string;
  sampleCodeframe?: string;
  category?: string;
  confidence: ClusterConfidence;
  chronicFlake: boolean;
  testCount: number;
  failureCount: number;
  tests: ClusterTest[];
  scope?: 'global' | 'local';
  regressionContext?: ClusterRegressionContext;
  lifecycle?: ClusterLifecycle;
  resolution?: ClusterResolution;
}

export type ClusterLifecycle = 'active' | 'resolved' | 'unattributed';

export interface ClusterResolution {
  resolvedAt: string;
  note?: string;
  manual: boolean;
}

export interface ClusterRegressionContext {
  membersInRegression: number;
  totalMembers: number;
  sharedRegressionCommit: string | null;
  earliestRegression: string | null;
}

export interface ClusterReport {
  clusters: FailureCluster[];
  totalFailures: number;
  windowDays?: number;
}

export interface ClusterOptions {
  project?: string;
  from?: string;
  to?: string;
  reportId?: string;
  testId?: string;
  fileId?: string;
  clusterId?: string;
  includeResolved?: boolean;
}
