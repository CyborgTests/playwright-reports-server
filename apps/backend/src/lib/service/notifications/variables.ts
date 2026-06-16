import {
  type EventCondition,
  eventVariableNames,
  formatDuration as formatDurationMs,
  type ScheduleCondition,
  scheduleVariableNames,
  sqliteTimestampToIso,
} from '@playwright-reports/shared';

export interface ReportLike {
  reportID: string;
  project: string;
  displayNumber?: number;
  title?: string;
  createdAt: Date | string;
  stats?: {
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
    total?: number;
  };
  duration?: number;
}

export function eventVariablesForCondition(condition: EventCondition): ReadonlySet<string> {
  return new Set<string>(eventVariableNames(condition));
}

export interface EventContext extends Record<string, unknown> {
  project: string;
  reportId: string;
  displayNumber: number | string;
  reportTitle: string;
  reportUrl: string;
  timestamp: string;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  total: number;
  totalWithSkipped: number;
  passRate: string;
  duration: string;
  durationMs: number;
  prevReportId?: string;
  prevDisplayNumber?: number | string;
  prevPassRate?: string;
  prevPassed?: number;
  prevFailed?: number;
  prevFlaky?: number;
  prevSkipped?: number;
  prevTotal?: number;
  prevTotalWithSkipped?: number;
  compareUrl?: string;
  newRegressions?: number;
  resolvedRegressions?: number;
}

function statCounts(report: ReportLike) {
  const expected = report.stats?.expected ?? 0;
  const unexpected = report.stats?.unexpected ?? 0;
  const flaky = report.stats?.flaky ?? 0;
  const skipped = report.stats?.skipped ?? 0;
  const executed = expected + unexpected + flaky;
  const totalWithSkipped = report.stats?.total ?? executed + skipped;
  const passRate = executed === 0 ? 100 : (expected / executed) * 100;
  return { expected, unexpected, flaky, skipped, executed, totalWithSkipped, passRate };
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '—';
  return formatDurationMs(ms);
}

function formatPassRate(rate: number): string {
  if (Number.isNaN(rate)) return '0.0';
  if (Number.isInteger(rate)) return `${rate}`;
  return rate.toFixed(1);
}

function compareUrl(serverUrl: string, prevId: string, currentId: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/reports/compare?a=${encodeURIComponent(prevId)}&b=${encodeURIComponent(currentId)}`;
}

function reportUrl(serverUrl: string, reportId: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/report/${encodeURIComponent(reportId)}`;
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return sqliteTimestampToIso(value) ?? value;
}

export function buildEventContext(args: {
  report: ReportLike;
  previous?: ReportLike;
  serverUrl: string;
  regressionsForReport?: { newHere: number; resolvedHere: number };
}): EventContext {
  const { report, previous, serverUrl, regressionsForReport } = args;
  const stats = statCounts(report);
  const ctx: EventContext = {
    project: report.project,
    reportId: report.reportID,
    displayNumber: report.displayNumber ?? '',
    reportTitle: report.title ?? '',
    reportUrl: reportUrl(serverUrl, report.reportID),
    timestamp: normalizeTimestamp(report.createdAt),
    passed: stats.expected,
    failed: stats.unexpected,
    flaky: stats.flaky,
    skipped: stats.skipped,
    total: stats.executed,
    totalWithSkipped: stats.totalWithSkipped,
    passRate: formatPassRate(stats.passRate),
    duration: formatDuration(report.duration),
    durationMs: report.duration ?? 0,
    newRegressions: regressionsForReport?.newHere,
    resolvedRegressions: regressionsForReport?.resolvedHere,
  };

  if (previous) {
    const prev = statCounts(previous);
    ctx.prevReportId = previous.reportID;
    ctx.prevDisplayNumber = previous.displayNumber ?? '';
    ctx.prevPassRate = formatPassRate(prev.passRate);
    ctx.prevPassed = prev.expected;
    ctx.prevFailed = prev.unexpected;
    ctx.prevFlaky = prev.flaky;
    ctx.prevSkipped = prev.skipped;
    ctx.prevTotal = prev.executed;
    ctx.prevTotalWithSkipped = prev.totalWithSkipped;
    ctx.compareUrl = compareUrl(serverUrl, previous.reportID, report.reportID);
  }

  return ctx;
}

export interface EventConditionContext {
  report: ReportLike;
  previous?: ReportLike;
  regressionsForReport?: { newHere: number; resolvedHere: number };
}

export function eventConditionMatches(
  condition: EventCondition,
  ctx: EventConditionContext
): boolean {
  const cur = statCounts(ctx.report);

  switch (condition) {
    case 'always':
      return true;
    case 'has_failures':
      return cur.unexpected > 0;
    case 'pass_rate_below_100':
      return cur.unexpected > 0 || cur.flaky > 0;
    case 'recovered_to_clean': {
      if (!ctx.previous) return false;
      const prev = statCounts(ctx.previous);
      const prevWasDirty = prev.unexpected > 0 || prev.flaky > 0;
      const curIsClean = cur.unexpected === 0 && cur.flaky === 0;
      return prevWasDirty && curIsClean;
    }
    case 'recovered_no_hard_failures': {
      if (!ctx.previous) return false;
      const prev = statCounts(ctx.previous);
      return prev.unexpected > 0 && cur.unexpected === 0;
    }
    case 'new_regressions':
      return (ctx.regressionsForReport?.newHere ?? 0) > 0;
    case 'resolved_regressions':
      return (ctx.regressionsForReport?.resolvedHere ?? 0) > 0;
    default: {
      const _exhaustive: never = condition;
      void _exhaustive;
      return false;
    }
  }
}

export function scheduleVariables(): ReadonlySet<string> {
  return new Set<string>(scheduleVariableNames());
}

interface ScheduleTopFailureCategory extends Record<string, unknown> {
  name: string;
  count: number;
  percentage: string;
}
interface ScheduleTopFailingTest extends Record<string, unknown> {
  title: string;
  failureCount: number;
  project: string;
}
interface ScheduleFlakiestTest extends Record<string, unknown> {
  title: string;
  flakinessScore: string;
  project: string;
}
interface ScheduleWorstProject extends Record<string, unknown> {
  project: string;
  passRate: string;
  failureCount: number;
}

export interface ScheduleContext extends Record<string, unknown> {
  windowStart: string;
  windowEnd: string;
  windowLabel: string;
  cadence: string;
  reportCount: number;
  projectCount: number;
  totalPassed: number;
  totalFailed: number;
  totalFlaky: number;
  totalSkipped: number;
  passRate: string;
  passRateDelta?: string;
  regressionsCount: number;
  recoveriesCount: number;
  topFailureCategories: ScheduleTopFailureCategory[];
  topFailingTests: ScheduleTopFailingTest[];
  flakiestTests: ScheduleFlakiestTest[];
  worstProjects: ScheduleWorstProject[];
  project: string;
  dashboardUrl: string;
}

/**
 * Aggregate summary input the dispatcher passes in. The actual aggregation
 * happens in `analyticsService.summarize()` (built in step 10); this type
 * pins the shape so the variable schema and the aggregator stay in sync.
 */
export interface ScheduleSummary {
  windowStart: string;
  windowEnd: string;
  windowLabel: string;
  cadence: string;
  reportCount: number;
  projectCount: number;
  totalPassed: number;
  totalFailed: number;
  totalFlaky: number;
  totalSkipped: number;
  /** Aggregate pass rate across all reports in the window, 0..100. */
  passRate: number;
  /** Delta vs previous window of same length, +/- percentage points. Null when no prior data. */
  passRateDelta: number | null;
  regressionsCount: number;
  recoveriesCount: number;
  topFailureCategories: Array<{ name: string; count: number; percentage: number }>;
  topFailingTests: Array<{ title: string; failureCount: number; project: string }>;
  flakiestTests: Array<{ title: string; flakinessScore: number; project: string }>;
  worstProjects: Array<{ project: string; passRate: number; failureCount: number }>;
  /** Project this aggregate was computed for during per-project fan-out, or "all". */
  project: string;
}

export function buildScheduleContext(args: {
  summary: ScheduleSummary;
  serverUrl: string;
}): ScheduleContext {
  const { summary, serverUrl } = args;
  const base = serverUrl.replace(/\/+$/, '');

  return {
    windowStart: summary.windowStart,
    windowEnd: summary.windowEnd,
    windowLabel: summary.windowLabel,
    cadence: summary.cadence,
    reportCount: summary.reportCount,
    projectCount: summary.projectCount,
    totalPassed: summary.totalPassed,
    totalFailed: summary.totalFailed,
    totalFlaky: summary.totalFlaky,
    totalSkipped: summary.totalSkipped,
    passRate: formatPassRate(summary.passRate),
    passRateDelta:
      summary.passRateDelta === null
        ? undefined
        : `${summary.passRateDelta > 0 ? '+' : ''}${formatPassRate(summary.passRateDelta)}`,
    regressionsCount: summary.regressionsCount,
    recoveriesCount: summary.recoveriesCount,
    topFailureCategories: summary.topFailureCategories.map((c) => ({
      name: c.name,
      count: c.count,
      percentage: formatPassRate(c.percentage),
    })),
    topFailingTests: summary.topFailingTests.map((t) => ({ ...t })),
    flakiestTests: summary.flakiestTests.map((t) => ({
      title: t.title,
      flakinessScore: formatPassRate(t.flakinessScore),
      project: t.project,
    })),
    worstProjects: summary.worstProjects.map((p) => ({
      project: p.project,
      passRate: formatPassRate(p.passRate),
      failureCount: p.failureCount,
    })),
    project: summary.project,
    dashboardUrl: base,
  };
}

// ─── Condition evaluation (schedule rules) ────────────────────────────────

/**
 * For schedule rules, the "condition" is evaluated against the aggregated
 * window summary — per-project after fan-out.
 */
export function scheduleConditionMatches(
  condition: ScheduleCondition,
  summary: ScheduleSummary
): boolean {
  // Hard guard: no activity in the window → never fire, regardless of
  // condition. The dispatcher could check this before calling here, but
  // making it explicit keeps the logic in one place.
  if (summary.reportCount === 0) return false;

  switch (condition) {
    case 'always':
      return true;
    case 'all_clean':
      return summary.totalFailed === 0 && summary.totalFlaky === 0;
    case 'no_hard_failures':
      return summary.totalFailed === 0;
    default: {
      const _exhaustive: never = condition;
      void _exhaustive;
      return false;
    }
  }
}
