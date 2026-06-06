export const API_ENDPOINTS = {
  // Auth
  AUTH_SIGNIN: '/api/auth/signin',
  AUTH_SIGNOUT: '/api/auth/signout',
  AUTH_SESSION: '/api/auth/session',

  // Reports
  REPORTS_LIST: '/api/report/list',
  REPORTS_DETAIL: '/api/report/:id',
  REPORTS_PROJECTS: '/api/report/projects',
  REPORTS_GENERATE: '/api/report/generate',
  REPORTS_DELETE: '/api/report/delete',
  REPORTS_EDIT: '/api/report/edit',
  REPORTS_COMPARE: '/api/report/compare',

  // Results
  RESULTS_LIST: '/api/result/list',
  RESULTS_PROJECTS: '/api/result/projects',
  RESULTS_TAGS: '/api/result/tags',
  RESULTS_DELETE: '/api/result/delete',
  RESULTS_UPLOAD: '/api/result/upload',

  // Config
  CONFIG: '/api/config',
  INFO: '/api/info',

  // Static
  STATIC: '/api/static',
  SERVE: '/api/serve',

  // Health
  PING: '/api/ping',
  HEALTH: '/api/health',

  // LLM feedback (test-level only)
  LLM_FEEDBACK: '/api/llm/feedback',
  LLM_FEEDBACK_RELATED: '/api/llm/feedback/related',
  LLM_REGENERATE: '/api/llm/regenerate',
  LLM_TEST_HISTORY: '/api/llm/test-history',
} as const;

export const TEST_OUTCOMES = {
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  FLAKY: 'flaky',
} as const;

export const STORAGE_TYPES = {
  FILESYSTEM: 'fs',
  S3: 's3',
  AZURE: 'azure',
} as const;

export const DEFAULT_CONFIG = {
  PORT: 3001,
  HOST: '0.0.0.0',
  CORS_ORIGIN: 'http://localhost:3000',
  DATA_STORAGE: 'fs',
  UI_AUTH_EXPIRE_HOURS: 2,
  FRONTEND_PORT: 3000,
} as const;

export const UPLOAD_LIMITS = {
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_FILES: 1,
  DEFAULT_CHUNK_SIZE: 25 * 1024 * 1024, // 25MB
} as const;

export const PAGINATION_DEFAULTS = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  DEFAULT_PAGE: 1,
} as const;

export const FLAKINESS_THRESHOLDS = {
  WARNING_PERCENTAGE: 2,
  QUARANTINE_PERCENTAGE: 5,
} as const;

// top-level keys that come from playwright report
export const RESERVED_REPORT_FIELDS: ReadonlySet<string> = new Set([
  'reportID',
  'title',
  'displayNumber',
  'project',
  'createdAt',
  'size',
  'sizeBytes',
  'reportUrl',
  'metadata',
  'stats',
  'files',
  'duration',
  'startTime',
  'errors',
  'projectNames',
  'options',
  'playwrightVersion',
]);

/**
 * Canonical failure-category enum used by the LLM classifier, UI filters, and
 * analytics. Order matters: it's the display order for filters and the order
 * presented to the LLM in the classification prompt.
 */
export const FAILURE_CATEGORIES = [
  'timeout',
  'element_not_visible',
  'element_not_found',
  'assertion_error',
  'snapshot_mismatch',
  'network_error',
  'api_error',
  'authentication_error',
  'navigation_error',
  'browser_crash',
  'setup_teardown',
  'javascript_error',
  'unknown',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** One-sentence tooltip per category — surfaced in the report failure summary
 *  chips so new users don't have to guess what each label covers. */
export const FAILURE_CATEGORY_DESCRIPTIONS: Record<FailureCategory, string> = {
  timeout: 'A Playwright timeout fired — the operation took longer than the configured budget.',
  element_not_visible:
    'The target element existed in the DOM but was not visible when interacted with.',
  element_not_found: 'The locator did not resolve to any element on the page.',
  assertion_error: 'An expect() assertion failed.',
  snapshot_mismatch: 'A visual or text snapshot differed from the recorded baseline.',
  network_error: 'A network request failed at the transport level (DNS, TCP, TLS).',
  api_error: 'An API call returned a non-success response or unexpected payload.',
  authentication_error: 'Sign-in flow rejected the credentials or session token.',
  navigation_error: 'page.goto / waitForNavigation failed to reach the expected URL.',
  browser_crash: 'The browser process crashed or disconnected mid-test.',
  setup_teardown: 'Failure in a beforeAll / afterAll / fixture — the test body never ran.',
  javascript_error: 'An uncaught JavaScript error was logged in the page during the test.',
  unknown: 'Could not be confidently classified by the heuristic or LLM.',
};

export const ROOT_CAUSE_CATEGORIES = [
  'app_bug',
  'test_bug',
  'infrastructure',
  'environment',
  'slow_path',
  'unknown',
] as const;

export type RootCauseCategory = (typeof ROOT_CAUSE_CATEGORIES)[number];

export const ROOT_CAUSE_CATEGORY_DESCRIPTIONS: Record<RootCauseCategory, string> = {
  app_bug: 'The application under test misbehaved — the test likely caught a defect.',
  test_bug: 'The test code is wrong (bad selector, missing wait, wrong assumption).',
  infrastructure: 'Runner, browser, or network outage; not related to application or test logic.',
  environment:
    'Test environment is in a bad state (missing data, stale fixtures, dependency unavailable).',
  slow_path: 'The operation finished, but past the timeout — likely a perf issue.',
  unknown: 'The LLM could not confidently decide from the evidence.',
};

/** Report-level verdicts emitted by the LLM summary. Mirrors
 *  ReportAnalysisVerdict in shared/types — keep in sync. */
export const REPORT_VERDICT_DESCRIPTIONS: Record<
  'isolated' | 'clustered' | 'widespread' | 'systemic',
  string
> = {
  isolated:
    'A small number of independent failures with no common cause — likely flakes or one-off bugs.',
  clustered: 'Multiple failures share the same error shape and likely have one root cause.',
  widespread: 'Failures span many tests and surfaces — investigate environment or shared infra.',
  systemic: 'Pervasive failure pattern; the test suite or system under test is in a broken state.',
};

export interface PromptVariable {
  name: string;
  description: string;
}

/**
 * Per-prompt {{var}} allowlist. Backend substitutes only these names; the
 * Settings UI surfaces them as autocomplete suggestions when the user types
 * `{{` in the corresponding prompt textarea.
 */
export const PROMPT_VARIABLES = {
  customTestAnalysisSystemPrompt: [] as PromptVariable[],
  customTestAnalysisInstructions: [
    { name: 'project', description: 'Project name from the report' },
    { name: 'testTitle', description: 'Full test title with describe path' },
    { name: 'filePath', description: 'Relative path to the test file' },
    { name: 'errorCategory', description: 'Categorized failure label' },
  ],
  customReportSummaryPrompt: [
    { name: 'reportId', description: 'Report identifier' },
    { name: 'project', description: 'Project name from the report' },
    { name: 'totalFailures', description: 'Number of failing tests in the run' },
  ],
  customProjectSummarySystemPrompt: [] as PromptVariable[],
  customProjectSummaryInstructions: [
    { name: 'project', description: 'Project name from the report' },
    { name: 'totalRuns', description: 'Number of runs in the evaluation window' },
    { name: 'passingRuns', description: 'Number of fully passing runs in that window' },
  ],
} as const;

export type PromptVariableKey = keyof typeof PROMPT_VARIABLES;
