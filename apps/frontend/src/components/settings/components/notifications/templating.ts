import {
  type EventCondition,
  eventVariableNames,
  renderTemplate,
  type ScheduleCondition,
  scheduleVariableNames,
} from '@playwright-reports/shared';

export function eventVariables(condition: EventCondition): readonly string[] {
  return eventVariableNames(condition);
}

export function scheduleVariables(): readonly string[] {
  return scheduleVariableNames();
}

export function previewRender(
  template: string,
  context: Record<string, unknown>,
  allowlist?: ReadonlySet<string>,
  transform?: (value: unknown) => string
): { output: string; error?: string; warnings?: string[] } {
  try {
    const { output, warnings } = renderTemplate(template, context, { allowlist, transform });
    return { output, warnings };
  } catch (err) {
    return { output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

const URL_VARS_SET = new Set(['reportUrl', 'compareUrl', 'dashboardUrl']);

export function urlVariablesOnly(variables: readonly string[]): readonly string[] {
  return variables.filter((v) => URL_VARS_SET.has(v));
}

interface AnyContext {
  [key: string]: unknown;
}

const BASE_EVENT_SAMPLE: AnyContext = {
  project: 'main:e2e',
  reportId: '8f2c1a4d-9e22-4b3f-9c5d-7e1b0a4f8e9c',
  displayNumber: 1247,
  reportTitle: 'PR#123 Run',
  reportUrl: 'https://reports.example.com/report/8f2c1a4d-9e22-4b3f-9c5d-7e1b0a4f8e9c',
  timestamp: `${new Date().toISOString().slice(0, 19)}Z`,
  passed: 180,
  failed: 14,
  flaky: 6,
  skipped: 8,
  total: 200,
  totalWithSkipped: 208,
  passRate: '90',
  duration: '1m 42s',
  durationMs: 102000,
};

const CLEAN_EVENT_SAMPLE: AnyContext = {
  ...BASE_EVENT_SAMPLE,
  passed: 200,
  failed: 0,
  flaky: 0,
  total: 200,
  totalWithSkipped: 208,
  passRate: '100',
};

const PASS_BELOW_100_SAMPLE: AnyContext = {
  ...BASE_EVENT_SAMPLE,
  passed: 194,
  failed: 0,
  flaky: 6,
  total: 200,
  totalWithSkipped: 208,
  passRate: '97',
};

const RECOVERED_PREV_DIRTY: AnyContext = {
  prevReportId: 'c3a7b218',
  prevDisplayNumber: 1246,
  prevPassRate: '78',
  prevPassed: 156,
  prevFailed: 38,
  prevFlaky: 6,
  prevSkipped: 8,
  prevTotal: 200,
  prevTotalWithSkipped: 208,
  compareUrl: 'https://reports.example.com/reports/compare?a=prev&b=cur',
};

export function sampleEventContext(condition: EventCondition): AnyContext {
  switch (condition) {
    case 'has_failures':
      return BASE_EVENT_SAMPLE;
    case 'pass_rate_below_100':
      return PASS_BELOW_100_SAMPLE;
    case 'recovered_to_clean':
      return { ...CLEAN_EVENT_SAMPLE, ...RECOVERED_PREV_DIRTY };
    case 'recovered_no_hard_failures':
      return { ...PASS_BELOW_100_SAMPLE, ...RECOVERED_PREV_DIRTY };
    case 'new_regressions':
      return { ...BASE_EVENT_SAMPLE, newRegressions: 3, resolvedRegressions: 0 };
    case 'resolved_regressions':
      return { ...CLEAN_EVENT_SAMPLE, newRegressions: 0, resolvedRegressions: 2 };
    case 'always':
      return BASE_EVENT_SAMPLE;
    default: {
      const _exhaustive: never = condition;
      void _exhaustive;
      return BASE_EVENT_SAMPLE;
    }
  }
}

const BASE_SCHEDULE_SAMPLE: AnyContext = {
  windowStart: '2026-06-04 09:00',
  windowEnd: '2026-06-05 09:00',
  windowLabel: 'last 24 hours',
  cadence: 'daily',
  reportCount: 18,
  projectCount: 1,
  totalPassed: 3420,
  totalFailed: 17,
  totalFlaky: 24,
  totalSkipped: 0,
  passRate: '98.8',
  passRateDelta: '+2.3',
  regressionsCount: 2,
  recoveriesCount: 5,
  topFailureCategories: [
    { name: 'app_bug', count: 9, percentage: '52.9' },
    { name: 'test_bug', count: 5, percentage: '29.4' },
    { name: 'infrastructure', count: 3, percentage: '17.6' },
  ],
  topFailingTests: [
    { title: 'checkout > pay with stored card', failureCount: 6, project: 'main:e2e' },
    { title: 'auth > SAML re-auth flow', failureCount: 4, project: 'main:e2e' },
    { title: 'cart > add discount code', failureCount: 3, project: 'main:e2e' },
  ],
  flakiestTests: [
    { title: 'profile > avatar upload', flakinessScore: '12.5', project: 'main:e2e' },
    { title: 'search > facets', flakinessScore: '8.3', project: 'main:e2e' },
  ],
  worstProjects: [{ project: 'main:e2e', passRate: '95.4', failureCount: 17 }],
  project: 'main:e2e',
  dashboardUrl: 'https://reports.example.com',
};

const ALL_CLEAN_SCHEDULE_SAMPLE: AnyContext = {
  ...BASE_SCHEDULE_SAMPLE,
  totalFailed: 0,
  totalFlaky: 0,
  passRate: '100',
  passRateDelta: '+1.2',
  regressionsCount: 0,
  recoveriesCount: 1,
  topFailureCategories: [],
  topFailingTests: [],
};

const NO_HARD_FAILURES_SAMPLE: AnyContext = {
  ...BASE_SCHEDULE_SAMPLE,
  totalFailed: 0,
  totalFlaky: 12,
  passRate: '99.6',
  regressionsCount: 0,
  recoveriesCount: 3,
};

export function sampleScheduleContext(condition: ScheduleCondition): AnyContext {
  switch (condition) {
    case 'always':
      return BASE_SCHEDULE_SAMPLE;
    case 'all_clean':
      return ALL_CLEAN_SCHEDULE_SAMPLE;
    case 'no_hard_failures':
      return NO_HARD_FAILURES_SAMPLE;
    default: {
      const _exhaustive: never = condition;
      void _exhaustive;
      return BASE_SCHEDULE_SAMPLE;
    }
  }
}
