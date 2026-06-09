import {
  FLAKINESS_THRESHOLDS,
  type ProjectFilter,
  type ScheduleCadence,
  type ScheduleRule,
} from '@playwright-reports/shared';
import type { ReportHistory } from '../../storage/types.js';
import { configCache } from '../cache/config.js';
import { failureSummaryDb } from '../db/failureSummary.sqlite.js';
import { notificationStateDb } from '../db/notificationState.sqlite.js';
import { reportDb } from '../db/reports.sqlite.js';
import { testDb } from '../db/tests.sqlite.js';
import { projectFilterMatches } from './filters.js';
import type { ScheduleSummary } from './variables.js';

const TOP_FAILING_TESTS_LIMIT = 5;
const FLAKIEST_TESTS_LIMIT = 5;
const TOP_FAILURE_CATEGORIES_LIMIT = 5;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface WindowRange {
  start: number;
  end: number;
  label: string;
}

export function resolveWindow(
  rule: ScheduleRule,
  channelId: string,
  project: string,
  now: number = Date.now()
): WindowRange {
  switch (rule.window) {
    case 'last_24h':
      return { start: now - DAY_MS, end: now, label: 'Last 24h' };
    case 'last_7d':
      return { start: now - 7 * DAY_MS, end: now, label: 'Last 7d' };
    case 'last_14d':
      return { start: now - 14 * DAY_MS, end: now, label: 'Last 14d' };
    case 'since_last_send': {
      const last = notificationStateDb.getLastFired(channelId, rule.id, project);
      const SINCE_LAST_SEND_CEILING = 14 * DAY_MS;
      const floor = now - SINCE_LAST_SEND_CEILING;
      const start = last === undefined ? now - DAY_MS : Math.max(floor, Math.min(last, now));
      return { start, end: now, label: 'Since last send' };
    }
  }
}

export function resolveDiscoveryWindow(rule: ScheduleRule, now: number = Date.now()): WindowRange {
  switch (rule.window) {
    case 'last_24h':
      return { start: now - DAY_MS, end: now, label: 'Last 24h' };
    case 'last_7d':
    case 'since_last_send':
      return { start: now - 7 * DAY_MS, end: now, label: 'Last 7d (discovery)' };
    case 'last_14d':
      return { start: now - 14 * DAY_MS, end: now, label: 'Last 14d (discovery)' };
  }
}

function describeCadence(cadence: ScheduleCadence): string {
  if (typeof cadence === 'string') return cadence;
  return `cron(${cadence.cron})`;
}

export function cadenceToCron(rule: ScheduleRule): string {
  if (typeof rule.cadence === 'object' && 'cron' in rule.cadence) {
    return rule.cadence.cron;
  }
  const [hStr, mStr] = (rule.sendAt || '09:00').split(':');
  const h = Number.parseInt(hStr ?? '9', 10);
  const m = Number.parseInt(mStr ?? '0', 10);
  const hh = Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 9;
  const mm = Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0;
  if (rule.cadence === 'daily') return `${mm} ${hh} * * *`;
  return `${mm} ${hh} * * 1`;
}

export function activeProjectsForWindow(filter: ProjectFilter, window: WindowRange): string[] {
  const reports = reportsInWindow(window);
  const seen = new Set<string>();
  for (const r of reports) {
    if (!projectFilterMatches(filter, r.project)) continue;
    seen.add(r.project);
  }
  return [...seen].sort();
}

export function buildSummaryForProject(args: {
  rule: ScheduleRule;
  project: string;
  window: WindowRange;
}): ScheduleSummary {
  const { rule, project, window } = args;
  const fromISO = new Date(window.start).toISOString();
  const toISO = new Date(window.end).toISOString();

  const all = reportsInWindow(window);
  const inScope = all.filter((r) => r.project === project);

  const totals = aggregateStats(inScope);
  const passRate = totals.passRate;

  const prevLen = window.end - window.start;
  const prevWindow: WindowRange = {
    start: window.start - prevLen,
    end: window.start,
    label: window.label,
  };
  const prevReports = reportsInWindow(prevWindow).filter((r) => r.project === project);
  const prevPassRate = prevReports.length === 0 ? null : aggregateStats(prevReports).passRate;
  const passRateDelta = prevPassRate === null ? null : passRate - prevPassRate;

  const projectCount = new Set(
    all.filter((r) => projectFilterMatches(rule.projectFilter, r.project)).map((r) => r.project)
  ).size;

  const seed = reportDb.getNewestReportBefore(project, fromISO);
  const { regressions, recoveries } = countReportTransitions(inScope, seed);

  const warningThreshold =
    configCache.config?.testManagement?.warningThresholdPercentage ??
    FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
  const scopedProject = project === 'all' ? undefined : project;

  const failureAgg = failureSummaryDb.getAggregatedCategories(
    scopedProject,
    TOP_FAILURE_CATEGORIES_LIMIT,
    { from: fromISO, to: toISO }
  );
  const topFailureCategories = failureAgg.categories
    .slice(0, TOP_FAILURE_CATEGORIES_LIMIT)
    .map((c) => ({ name: c.category, count: c.count, percentage: c.percentage }));

  const topFailingTests = testDb
    .getTopFailingTestsInWindow(scopedProject, fromISO, toISO, TOP_FAILING_TESTS_LIMIT)
    .map((t) => ({ title: t.title, failureCount: t.failureCount, project: t.project }));

  const flakiestTests = testDb
    .getFlakiestTestsInWindow(scopedProject, fromISO, toISO, FLAKIEST_TESTS_LIMIT, warningThreshold)
    .map((t) => ({ title: t.title, flakinessScore: t.flakinessScore, project: t.project }));

  return {
    windowStart: fromISO,
    windowEnd: toISO,
    windowLabel: window.label,
    cadence: describeCadence(rule.cadence),
    reportCount: inScope.length,
    projectCount,
    totalPassed: totals.expected,
    totalFailed: totals.unexpected,
    totalFlaky: totals.flaky,
    totalSkipped: totals.skipped,
    passRate,
    passRateDelta,
    regressionsCount: regressions,
    recoveriesCount: recoveries,
    topFailureCategories,
    topFailingTests,
    flakiestTests,
    worstProjects: worstProjectsForReports(inScope),
    project,
  };
}

function countReportTransitions(
  inScopeDesc: ReportHistory[],
  seed: ReportHistory | undefined
): { regressions: number; recoveries: number } {
  let regressions = 0;
  let recoveries = 0;
  let prevHadFailures: boolean | null = seed ? (seed.stats?.unexpected ?? 0) > 0 : null;
  for (let i = inScopeDesc.length - 1; i >= 0; i--) {
    const cur = (inScopeDesc[i].stats?.unexpected ?? 0) > 0;
    if (prevHadFailures === null) {
      prevHadFailures = cur;
      continue;
    }
    if (!prevHadFailures && cur) regressions++;
    else if (prevHadFailures && !cur) recoveries++;
    prevHadFailures = cur;
  }
  return { regressions, recoveries };
}

function reportsInWindow(window: WindowRange): ReportHistory[] {
  return reportDb.getByProject(undefined, {
    from: new Date(window.start).toISOString(),
    to: new Date(window.end).toISOString(),
  });
}

interface AggregateStats {
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  total: number;
  passRate: number;
}

function aggregateStats(reports: ReportHistory[]): AggregateStats {
  let expected = 0;
  let unexpected = 0;
  let flaky = 0;
  let skipped = 0;
  for (const r of reports) {
    expected += r.stats?.expected ?? 0;
    unexpected += r.stats?.unexpected ?? 0;
    flaky += r.stats?.flaky ?? 0;
    skipped += r.stats?.skipped ?? 0;
  }
  const total = expected + unexpected + flaky + skipped;
  const executed = expected + unexpected + flaky;
  const passRate = executed === 0 ? 100 : (expected / executed) * 100;
  return { expected, unexpected, flaky, skipped, total, passRate };
}

function worstProjectsForReports(
  reports: ReportHistory[]
): Array<{ project: string; passRate: number; failureCount: number }> {
  const byProject = new Map<string, { passed: number; executed: number; failures: number }>();
  for (const r of reports) {
    const cur = byProject.get(r.project) ?? { passed: 0, executed: 0, failures: 0 };
    cur.passed += r.stats?.expected ?? 0;
    cur.failures += r.stats?.unexpected ?? 0;
    cur.executed += (r.stats?.expected ?? 0) + (r.stats?.unexpected ?? 0) + (r.stats?.flaky ?? 0);
    byProject.set(r.project, cur);
  }
  return [...byProject.entries()]
    .map(([project, v]) => ({
      project,
      passRate: v.executed === 0 ? 100 : (v.passed / v.executed) * 100,
      failureCount: v.failures,
    }))
    .sort((a, b) => a.passRate - b.passRate)
    .slice(0, 5);
}
