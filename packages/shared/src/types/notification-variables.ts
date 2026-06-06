import type { EventCondition } from './notifications.js';

export const EVENT_BASE_VARS = [
  'project',
  'reportId',
  'displayNumber',
  'reportTitle',
  'reportUrl',
  'timestamp',
  'passed',
  'failed',
  'flaky',
  'skipped',
  // `total` = executed (passed + failed + flaky)
  // `totalWithSkipped` includes skipped tests
  'total',
  'totalWithSkipped',
  'passRate',
  'duration',
  'durationMs',
] as const;

export const EVENT_RECOVERED_EXTRA = [
  'prevReportId',
  'prevDisplayNumber',
  'prevPassRate',
  'prevPassed',
  'prevFailed',
  'prevFlaky',
  'prevSkipped',
  'prevTotal',
  'prevTotalWithSkipped',
  'compareUrl',
] as const;

export const SCHEDULE_VARS = [
  // window
  'windowStart',
  'windowEnd',
  'windowLabel',
  'cadence',
  // count
  'reportCount',
  'projectCount',
  'totalPassed',
  'totalFailed',
  'totalFlaky',
  'totalSkipped',
  'passRate',
  // changes
  'passRateDelta',
  'regressionsCount',
  'recoveriesCount',
  // iterables
  'topFailureCategories',
  'topFailingTests',
  'flakiestTests',
  'worstProjects',
  // per-project
  'project',
  // links
  'dashboardUrl',
] as const;

export function eventVariableNames(condition: EventCondition): readonly string[] {
  if (condition === 'recovered_to_clean' || condition === 'recovered_no_hard_failures') {
    return [...EVENT_BASE_VARS, ...EVENT_RECOVERED_EXTRA];
  }
  return EVENT_BASE_VARS;
}

export function scheduleVariableNames(): readonly string[] {
  return SCHEDULE_VARS;
}
