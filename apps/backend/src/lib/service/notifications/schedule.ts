import type { ProjectFilter, ScheduleCadence, ScheduleRule } from '@playwright-reports/shared';
import type { ReportHistory } from '../../storage/types.js';
import { notificationStateDb } from '../db/notificationState.sqlite.js';
import { reportDb } from '../db/reports.sqlite.js';
import { projectFilterMatches } from './filters.js';
import type { ScheduleSummary } from './variables.js';

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

  const projectsInWindow = new Set(inScope.map((r) => r.project)).size;

  return {
    windowStart: new Date(window.start).toISOString(),
    windowEnd: new Date(window.end).toISOString(),
    windowLabel: window.label,
    cadence: describeCadence(rule.cadence),
    reportCount: inScope.length,
    projectCount: projectsInWindow,
    totalPassed: totals.expected,
    totalFailed: totals.unexpected,
    totalFlaky: totals.flaky,
    totalSkipped: totals.skipped,
    passRate,
    passRateDelta,
    regressionsCount: 0,
    recoveriesCount: 0,
    topFailureCategories: [],
    topFailingTests: [],
    flakiestTests: [],
    worstProjects: worstProjectsForReports(inScope),
    project,
  };
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
