export const API_ENDPOINTS = {
  // Auth
  AUTH_SIGNIN: '/api/auth/signin',
  AUTH_SIGNOUT: '/api/auth/signout',
  AUTH_SESSION: '/api/auth/session',
  AUTH_CSRF: '/api/auth/csrf',

  // Reports
  REPORTS_LIST: '/api/report/list',
  REPORTS_DETAIL: '/api/report/:id',
  REPORTS_PROJECTS: '/api/report/projects',
  REPORTS_GENERATE: '/api/report/generate',
  REPORTS_DELETE: '/api/report/delete',
  REPORTS_TREND: '/api/report/trend',
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
