import type {
  AnalyticsData,
  OverviewStats,
  RunHealthMetric,
  StatDelta,
  StepTimingTrend,
  TrendMetrics,
} from '@playwright-reports/shared';
import { FLAKINESS_THRESHOLDS } from '@playwright-reports/shared';
import type { ReportHistory as BackendReportHistory } from '../storage/types.js';
import { failureSummaryDb, regressionsDb, reportDb, testDb } from './db/index.js';
import { service } from './index.js';
import { testManagementService } from './test-management/index.js';

const HEALTH_GRID_UNBOUNDED_CAP = 200;

type Window = { from?: string; to?: string };

/** minimal aggregate used by trend-delta calculations */
interface TrendAggregate {
  count: number;
  totalPassed: number;
  totalExecuted: number;
  totalFlaky: number;
  sumDuration: number;
}

const EMPTY_TREND_AGGREGATE: TrendAggregate = {
  count: 0,
  totalPassed: 0,
  totalExecuted: 0,
  totalFlaky: 0,
  sumDuration: 0,
};

function aggregateFromRows(reports: BackendReportHistory[]): TrendAggregate {
  let totalPassed = 0;
  let totalFailed = 0;
  let totalFlaky = 0;
  let sumDuration = 0;
  for (const r of reports) {
    totalPassed += r.stats?.expected ?? 0;
    totalFailed += r.stats?.unexpected ?? 0;
    totalFlaky += r.stats?.flaky ?? 0;
    sumDuration += r.duration ?? 0;
  }
  return {
    count: reports.length,
    totalPassed,
    totalExecuted: totalPassed + totalFailed + totalFlaky,
    totalFlaky,
    sumDuration,
  };
}

function passRateOf(agg: TrendAggregate): number {
  return agg.totalExecuted > 0 ? (agg.totalPassed / agg.totalExecuted) * 100 : 0;
}

function avgDurationOf(agg: TrendAggregate): number {
  return agg.count > 0 ? agg.sumDuration / agg.count : 0;
}

function windowFromReports(reports: BackendReportHistory[]): Window {
  if (reports.length === 0) return {};
  const newest = reports[0]?.createdAt;
  const oldest = reports[reports.length - 1]?.createdAt;
  return {
    from: oldest ? new Date(oldest).toISOString() : undefined,
    to: newest ? new Date(new Date(newest).getTime() + 1).toISOString() : undefined,
  };
}

export class AnalyticsService {
  async getAnalyticsData(
    project?: string,
    from?: string,
    to?: string,
    failedOnly = false
  ): Promise<AnalyticsData> {
    const fetchScope = await this.fetchReportsForScope(project, from, to, failedOnly);
    const { displayReports, recentForTrend, olderTrendAggregate, olderRange, isBounded } =
      this.partitionReports(
        fetchScope.reports,
        from,
        to,
        fetchScope.olderRange,
        fetchScope.olderAggregate
      );

    const config = await service.getConfig();
    const warningThreshold =
      config.testManagement?.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
    const projectKey = project && project !== 'all' ? project : undefined;

    const recentRange = isBounded
      ? { from: from ?? undefined, to: to ?? undefined }
      : windowFromReports(recentForTrend);
    const previousRange = olderRange ?? {};

    const [
      overviewStats,
      runHealthMetrics,
      trendMetrics,
      testsSummary,
      previousTestsSummary,
      failureCategories,
      regressions,
    ] = await Promise.all([
      this.calculateOverviewStats(
        displayReports,
        recentForTrend,
        olderTrendAggregate,
        projectKey,
        recentRange,
        previousRange
      ),
      this.calculateRunHealthMetrics(displayReports, isBounded),
      this.calculateTrendMetrics(displayReports, projectKey, recentRange),
      testManagementService.getTestsSummary(projectKey, warningThreshold, { from, to }),
      olderRange
        ? testManagementService.getTestsSummary(projectKey, warningThreshold, olderRange)
        : Promise.resolve({ total: 0, flakyCount: 0 }),
      Promise.resolve(failureSummaryDb.getAggregatedCategories(projectKey, 10, { from, to })),
      Promise.resolve(
        regressionsDb.aggregateForAnalytics({ project: projectKey, since: from, until: to })
      ),
    ]);

    if (olderRange) {
      overviewStats.flakyTestsTrend = this.calculateTrend(
        testsSummary.flakyCount,
        previousTestsSummary.flakyCount,
        warningThreshold
      );
      overviewStats.deltas = {
        ...overviewStats.deltas,
        flakyTests: this.computeDelta(
          testsSummary.flakyCount,
          previousTestsSummary.flakyCount,
          warningThreshold
        ),
      };
    }

    return {
      overviewStats,
      runHealthMetrics,
      trendMetrics,
      testsSummary,
      failureCategories,
      regressions,
    };
  }

  private async fetchReportsForScope(
    project: string | undefined,
    from: string | undefined,
    to: string | undefined,
    failedOnly: boolean
  ): Promise<{
    reports: BackendReportHistory[];
    olderAggregate: TrendAggregate | null;
    olderRange: { from: string; to: string } | null;
  }> {
    if (!from && !to) {
      return {
        reports: reportDb.getByProject(project, { failedOnly }),
        olderAggregate: null,
        olderRange: null,
      };
    }

    const reports = reportDb.getByProject(project, { from, to, failedOnly });

    const fromMs = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
    const toMs = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
    const duration = Number.isFinite(toMs) && Number.isFinite(fromMs) ? toMs - fromMs : null;
    if (duration === null || duration <= 0) {
      return { reports, olderAggregate: EMPTY_TREND_AGGREGATE, olderRange: null };
    }
    const compFrom = new Date(fromMs - duration).toISOString();
    const compTo = new Date(fromMs).toISOString();
    const olderAggregate = reportDb.aggregateForAnalytics(project, compFrom, compTo, {
      failedOnly,
    });
    return {
      reports,
      olderAggregate,
      olderRange: { from: compFrom, to: compTo },
    };
  }

  /**
   * Split reports into `displayReports` (dashboard aggregates) and the
   * `recentForTrend`/`olderForTrend` pair the trend arrows compare.
   * Bounded window [from, to]: display & recent are the in-window reports;
   * older is the equal-duration period immediately before it.
   * All-time: display is everything; recent/older are the newer/older halves
   * split at the date midpoint.
   */
  private partitionReports(
    allReports: BackendReportHistory[],
    from?: string,
    to?: string,
    preFetchedOlderRange?: { from: string; to: string } | null,
    preFetchedOlderAggregate?: TrendAggregate | null
  ): {
    displayReports: BackendReportHistory[];
    recentForTrend: BackendReportHistory[];
    olderTrendAggregate: TrendAggregate;
    olderRange: { from: string; to: string } | null;
    isBounded: boolean;
  } {
    if (from || to) {
      return {
        displayReports: allReports,
        recentForTrend: allReports,
        olderTrendAggregate: preFetchedOlderAggregate ?? EMPTY_TREND_AGGREGATE,
        olderRange: preFetchedOlderRange ?? null,
        isBounded: true,
      };
    }

    if (allReports.length < 2) {
      return {
        displayReports: allReports,
        recentForTrend: allReports,
        olderTrendAggregate: EMPTY_TREND_AGGREGATE,
        olderRange: null,
        isBounded: false,
      };
    }
    const mid = Math.floor(allReports.length / 2);
    const olderRows = allReports.slice(mid);
    const olderRange = windowFromReports(olderRows);
    return {
      displayReports: allReports,
      recentForTrend: allReports.slice(0, mid),
      olderTrendAggregate: aggregateFromRows(olderRows),
      olderRange:
        olderRange.from && olderRange.to ? { from: olderRange.from, to: olderRange.to } : null,
      isBounded: false,
    };
  }

  private async calculateOverviewStats(
    displayReports: BackendReportHistory[],
    recentForTrend: BackendReportHistory[],
    olderTrendAggregate: TrendAggregate,
    project: string | undefined,
    recentRange: Window,
    previousRange: Window
  ): Promise<OverviewStats> {
    const totalTests = displayReports.reduce((sum, report) => sum + (report.stats?.total || 0), 0);

    const totalPassed = displayReports.reduce(
      (sum, report) => sum + (report.stats?.expected || 0),
      0
    );
    // Skipped tests are excluded from pass rate — they aren't pass/fail outcomes.
    const totalExecuted = displayReports.reduce(
      (sum, report) =>
        sum +
        (report.stats?.expected || 0) +
        (report.stats?.unexpected || 0) +
        (report.stats?.flaky || 0),
      0
    );
    const passRate = totalExecuted > 0 ? (totalPassed / totalExecuted) * 100 : 0;

    const recentAgg = testDb.getDurationAggregates(project, recentRange.from, recentRange.to);
    const olderAgg = testDb.getDurationAggregates(project, previousRange.from, previousRange.to);
    const slowestSteps = testDb.getSlowestTests(project, recentRange.from, recentRange.to, 10);
    const averageTestDuration = recentAgg.avgDuration;
    const olderAverageTestDuration = olderAgg.avgDuration;

    const averageTestRunDuration =
      displayReports.length > 0
        ? displayReports.reduce((sum, report) => sum + (report.duration || 0), 0) /
          displayReports.length
        : 0;

    const recentPassRate = await this.calculatePreviousPassRate(recentForTrend);
    const olderPassRate = passRateOf(olderTrendAggregate);
    const passRateTrend = this.calculateTrend(recentPassRate, olderPassRate, 2);

    const config = await service.getConfig();
    const flakinessThreshold =
      config.testManagement?.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;

    const recentFlakyOccurrences = recentForTrend.reduce(
      (sum, report) => sum + (report.stats?.flaky || 0),
      0
    );
    const olderFlakyOccurrences = olderTrendAggregate.totalFlaky;
    const flakyTestsTrend = this.calculateTrend(
      recentFlakyOccurrences,
      olderFlakyOccurrences,
      flakinessThreshold
    );

    const olderAverageRunDuration = avgDurationOf(olderTrendAggregate);

    const deltas = {
      passRate: this.computeDelta(recentPassRate, olderPassRate, 2),
      flakyTests: this.computeDelta(
        recentFlakyOccurrences,
        olderFlakyOccurrences,
        flakinessThreshold
      ),
      averageTestDuration: this.computeDelta(averageTestDuration, olderAverageTestDuration, 5),
      averageTestRunDuration: this.computeDelta(averageTestRunDuration, olderAverageRunDuration, 5),
    };

    return {
      totalRuns: displayReports.length,
      totalTests,
      passRate: Math.round(passRate * 100) / 100,
      averageTestDuration: Math.round(averageTestDuration),
      slowestSteps,
      averageTestRunDuration,
      passRateTrend,
      flakyTestsTrend,
      deltas,
    };
  }

  private computeDelta(current: number, previous: number, thresholdPercent: number): StatDelta {
    if (previous === 0) {
      if (current === 0) return { percent: 0, trend: 'stable' };
      return { percent: null, trend: 'up' };
    }
    const percent = ((current - previous) / previous) * 100;
    const trend: 'up' | 'down' | 'stable' =
      Math.abs(percent) < thresholdPercent ? 'stable' : percent > 0 ? 'up' : 'down';
    return { percent: Math.round(percent * 10) / 10, trend };
  }

  private async calculateRunHealthMetrics(
    reports: BackendReportHistory[],
    isBounded: boolean
  ): Promise<RunHealthMetric[]> {
    const limited = isBounded ? reports : reports.slice(0, HEALTH_GRID_UNBOUNDED_CAP);
    const regressionCounts = regressionsDb.countsForReports(limited.map((r) => r.reportID));
    return limited.map((report) => {
      const stats = report.stats;
      const totalTests = stats?.total || 0;
      const passed = stats?.expected || 0;
      const failed = stats?.unexpected || 0;
      const flaky = stats?.flaky || 0;
      const counts = regressionCounts.get(report.reportID);
      const newRegressions = counts?.newHere ?? 0;
      const resolvedRegressions = counts?.resolvedHere ?? 0;

      return {
        runId: report.reportID,
        timestamp: new Date(report.createdAt),
        totalTests,
        passed,
        failed,
        flaky,
        duration: report.duration || 0,
        title: report.title,
        displayNumber: report.displayNumber,
        newRegressions: newRegressions > 0 ? newRegressions : undefined,
        resolvedRegressions: resolvedRegressions > 0 ? resolvedRegressions : undefined,
      };
    });
  }

  private async calculateTrendMetrics(
    displayReports: BackendReportHistory[],
    project: string | undefined,
    recentRange: Window
  ): Promise<TrendMetrics> {
    const durationTrend = displayReports.map((report) => ({
      date: new Date(report.createdAt).toISOString(),
      duration: report.duration || 0,
    }));

    const flakyCountTrend = displayReports.map((report) => ({
      date: new Date(report.createdAt).toISOString(),
      count: report.stats?.flaky || 0,
    }));

    const { p95Duration } = testDb.getDurationAggregates(project, recentRange.from, recentRange.to);
    const slowThreshold = p95Duration > 0 ? p95Duration : 1000;
    const slowCountsByReport = testDb.getSlowCountsByReport(
      project,
      recentRange.from,
      recentRange.to,
      slowThreshold
    );
    const slowCountTrend = displayReports.map((report) => ({
      date: new Date(report.createdAt).toISOString(),
      count: slowCountsByReport.get(report.reportID) ?? 0,
    }));

    return {
      durationTrend,
      flakyCountTrend,
      slowCountTrend,
    };
  }

  private async calculatePreviousPassRate(reports: BackendReportHistory[]): Promise<number> {
    if (reports.length === 0) return 0;

    let totalExecuted = 0;
    let totalPassed = 0;
    for (const report of reports) {
      const expected = report.stats?.expected || 0;
      totalPassed += expected;
      totalExecuted += expected + (report.stats?.unexpected || 0) + (report.stats?.flaky || 0);
    }

    return totalExecuted > 0 ? (totalPassed / totalExecuted) * 100 : 0;
  }

  private calculateTrend(
    current: number,
    previous: number,
    thresholdPercent: number
  ): 'up' | 'down' | 'stable' {
    if (previous === 0) {
      return current === 0 ? 'stable' : 'up';
    }
    const percentChange = ((current - previous) / previous) * 100;
    if (Math.abs(percentChange) < thresholdPercent) {
      return 'stable';
    }
    return percentChange > 0 ? 'up' : 'down';
  }

  async getTestTrends(testId: string, projectName?: string): Promise<StepTimingTrend | null> {
    const trendRuns = testDb.getDurationTrend(testId, projectName);

    if (trendRuns.length === 0) {
      return null;
    }

    const runs = trendRuns.map((r) => ({
      runId: r.reportId,
      runDate: new Date(r.createdAt),
      duration: r.duration,
      isOutlier: false,
    }));
    const durations = trendRuns.map((r) => r.duration).sort((a, b) => a - b);

    const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const median =
      durations.length % 2 === 0
        ? (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
        : durations[Math.floor(durations.length / 2)];

    const variance = durations.reduce((sum, d) => sum + (d - mean) ** 2, 0) / durations.length;
    const stdDev = Math.sqrt(variance);

    for (const run of runs) {
      run.isOutlier = Math.abs(run.duration - mean) > 2 * stdDev;
    }

    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);

    const testName = testDb.getTestTitle(testId, projectName) ?? 'Unknown Test';

    return {
      stepId: testId,
      stepName: testName,
      runs: runs.sort((a, b) => a.runDate.getTime() - b.runDate.getTime()),
      statistics: {
        mean: Math.round(mean),
        median: Math.round(median),
        stdDev: Math.round(stdDev),
        min: Math.min(...durations),
        max: Math.max(...durations),
        p95: durations[p95Index] || 0,
        p99: durations[p99Index] || 0,
      },
    };
  }
}

export const analyticsService = new AnalyticsService();
