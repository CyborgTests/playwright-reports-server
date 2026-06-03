/**
 * Failure-clustering types.
 *
 * Each failed Playwright test_run is assigned to exactly one cluster via a
 * deterministic anchor. Two failures share a cluster iff their anchors are
 * equal. There is no merging, no precedence resolution, no temporal/signature
 * grouping — the anchor IS the cluster. This produces:
 *  - Stable cluster IDs across calls (id = hash(anchor)).
 *  - "One cluster = one fix" semantics by construction.
 *  - A small, named set of cluster kinds the LLM/UI can branch on.
 */

export type FixturePhase = 'beforeAll' | 'beforeEach' | 'afterAll' | 'afterEach';

export type PlaywrightVerb =
  // Locator assertions
  | 'toBeVisible'
  | 'toBeHidden'
  | 'toBeAttached'
  | 'toBeEnabled'
  | 'toBeDisabled'
  | 'toBeChecked'
  | 'toBeEmpty'
  | 'toBeFocused'
  | 'toHaveText'
  | 'toHaveValue'
  | 'toHaveCount'
  | 'toHaveAttribute'
  | 'toHaveClass'
  | 'toContainText'
  // Page assertions
  | 'toHaveURL'
  | 'toHaveTitle'
  // Value assertions
  | 'toBe'
  | 'toEqual'
  | 'toMatch'
  | 'toMatchObject'
  | 'toContain'
  | 'toBeTruthy'
  | 'toBeFalsy'
  // Locator actions
  | 'click'
  | 'fill'
  | 'press'
  | 'type'
  | 'check'
  | 'uncheck'
  | 'hover'
  | 'focus'
  | 'blur'
  | 'selectOption'
  | 'setInputFiles'
  | 'dragTo'
  | 'screenshot'
  | 'waitFor'
  // Page actions
  | 'goto'
  | 'reload'
  | 'waitForURL'
  | 'waitForSelector'
  | 'waitForLoadState'
  // Strict-mode violation isn't a verb but a class of failure; tagged
  // explicitly because the fix is selector-disambiguation.
  | 'strictModeViolation'
  // Bare `Test timeout of Nms exceeded.` with no verb context.
  | 'testTimeout'
  // Couldn't classify — anchor falls back to test identity.
  | 'unknown';

/**
 * The anchor uniquely identifies a cluster. Discriminated union by `kind`.
 * Priority during classification: fixture > selector > frame > unmatched.
 */
export type ClusterAnchor =
  | { kind: 'fixture'; verb: PlaywrightVerb; phase: FixturePhase; filePath: string }
  | { kind: 'selector'; verb: PlaywrightVerb; selector: string }
  | { kind: 'frame'; verb: PlaywrightVerb; frame: string }
  | {
      kind: 'unmatched';
      testId: string;
      fileId: string;
      project: string;
    };

export type ClusterAnchorKind = ClusterAnchor['kind'];

export type ClusterConfidence = 'high' | 'medium' | 'low';

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
  category?: string;
  confidence: ClusterConfidence;
  testCount: number;
  failureCount: number;
  tests: ClusterTest[];
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
}
