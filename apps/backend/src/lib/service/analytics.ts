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
import { failureSummaryDb } from './db/failureSummary.sqlite.js';
import { reportDb } from './db/reports.sqlite.js';
import { service } from './index.js';
import { testManagementService } from './testManagement.js';

const HEALTH_GRID_UNBOUNDED_CAP = 200;

export class AnalyticsService {
  async getAnalyticsData(
    project?: string,
    from?: string,
    to?: string,
    failedOnly = false
  ): Promise<AnalyticsData> {
    const allReports = await this.getAllReportsForProject(project);
    // failedOnly narrows EVERY computation to runs that actually had failures —
    // applied before partitioning so the trend baseline ("previous period") is
    // computed against the same filtered population.
    const scoped = failedOnly
      ? allReports.filter((r) => (r.stats?.unexpected ?? 0) > 0 || (r.stats?.flaky ?? 0) > 0)
      : allReports;
    const { displayReports, recentForTrend, olderForTrend, olderRange, isBounded } =
      this.partitionReports(scoped, from, to);

    const config = await service.getConfig();
    const warningThreshold =
      config.testManagement?.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
    const projectKey = project && project !== 'all' ? project : undefined;

    const [
      overviewStats,
      runHealthMetrics,
      trendMetrics,
      testsSummary,
      previousTestsSummary,
      failureCategories,
    ] = await Promise.all([
      this.calculateOverviewStats(displayReports, recentForTrend, olderForTrend),
      this.calculateRunHealthMetrics(displayReports, isBounded),
      this.calculateTrendMetrics(displayReports, scoped),
      testManagementService.getTestsSummary(projectKey, warningThreshold, { from, to }),
      olderRange
        ? testManagementService.getTestsSummary(projectKey, warningThreshold, olderRange)
        : Promise.resolve({ total: 0, flakyCount: 0 }),
      Promise.resolve(failureSummaryDb.getAggregatedCategories(projectKey, 10, { from, to })),
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
    };
  }

  private async getAllReportsForProject(project?: string): Promise<BackendReportHistory[]> {
    if (project) {
      return reportDb.getByProject(project);
    }
    return reportDb.getAll();
  }

  /**
   * Split reports into:
   *   - `displayReports` — what the dashboard cards display (visible aggregates).
   *   - `recentForTrend` / `olderForTrend` — what the trend arrows compare against each other.
   *
   * For a bounded window [from, to]:
   *   display & recentForTrend are the reports inside the window.
   *   olderForTrend is the equivalent prior period (same duration, immediately preceding).
   *
   * For "all time":
   *   display is all reports.
   *   recentForTrend / olderForTrend = newer-half / older-half by date midpoint.
   */
  private partitionReports(
    allReports: BackendReportHistory[],
    from?: string,
    to?: string
  ): {
    displayReports: BackendReportHistory[];
    recentForTrend: BackendReportHistory[];
    olderForTrend: BackendReportHistory[];
    olderRange: { from: string; to: string } | null;
    isBounded: boolean;
  } {
    if (from || to) {
      const fromMs = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
      const toMs = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
      const display = allReports.filter((r) => {
        const t = new Date(r.createdAt).getTime();
        return t >= fromMs && t < toMs;
      });

      const duration = Number.isFinite(toMs) && Number.isFinite(fromMs) ? toMs - fromMs : null;
      let older: BackendReportHistory[] = [];
      let olderRange: { from: string; to: string } | null = null;
      if (duration !== null && duration > 0) {
        const compTo = fromMs;
        const compFrom = fromMs - duration;
        older = allReports.filter((r) => {
          const t = new Date(r.createdAt).getTime();
          return t >= compFrom && t < compTo;
        });
        olderRange = { from: new Date(compFrom).toISOString(), to: new Date(compTo).toISOString() };
      }
      return {
        displayReports: display,
        recentForTrend: display,
        olderForTrend: older,
        olderRange,
        isBounded: true,
      };
    }

    if (allReports.length < 2) {
      return {
        displayReports: allReports,
        recentForTrend: allReports,
        olderForTrend: [],
        olderRange: null,
        isBounded: false,
      };
    }
    // allReports is sorted DESC; split by midpoint index = newer / older halves
    const mid = Math.floor(allReports.length / 2);
    return {
      displayReports: allReports,
      recentForTrend: allReports.slice(0, mid),
      olderForTrend: allReports.slice(mid),
      olderRange: null,
      isBounded: false,
    };
  }

  private async calculateOverviewStats(
    displayReports: BackendReportHistory[],
    recentForTrend: BackendReportHistory[],
    olderForTrend: BackendReportHistory[]
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

    const testDurations = await this.extractTestDurations(displayReports);
    const averageTestDuration =
      testDurations.length > 0
        ? testDurations.reduce((sum, duration) => sum + duration, 0) / testDurations.length
        : 0;

    const slowestSteps = await this.findSlowestSteps(displayReports, 10);

    const averageTestRunDuration =
      displayReports.length > 0
        ? displayReports.reduce((sum, report) => sum + (report.duration || 0), 0) /
          displayReports.length
        : 0;

    const recentPassRate = await this.calculatePreviousPassRate(recentForTrend);
    const olderPassRate = await this.calculatePreviousPassRate(olderForTrend);
    const passRateTrend = this.calculateTrend(recentPassRate, olderPassRate, 2);

    const config = await service.getConfig();
    const flakinessThreshold =
      config.testManagement?.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;

    const recentFlakyOccurrences = recentForTrend.reduce(
      (sum, report) => sum + (report.stats?.flaky || 0),
      0
    );
    const olderFlakyOccurrences = olderForTrend.reduce(
      (sum, report) => sum + (report.stats?.flaky || 0),
      0
    );
    const flakyTestsTrend = this.calculateTrend(
      recentFlakyOccurrences,
      olderFlakyOccurrences,
      flakinessThreshold
    );

    const olderTestDurations = await this.extractTestDurations(olderForTrend);
    const olderAverageTestDuration =
      olderTestDurations.length > 0
        ? olderTestDurations.reduce((sum, d) => sum + d, 0) / olderTestDurations.length
        : 0;

    const olderAverageRunDuration =
      olderForTrend.length > 0
        ? olderForTrend.reduce((sum, report) => sum + (report.duration || 0), 0) /
          olderForTrend.length
        : 0;

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
    return limited.map((report) => {
      const stats = report.stats;
      const totalTests = stats?.total || 0;
      const passed = stats?.expected || 0;
      const failed = stats?.unexpected || 0;
      const flaky = stats?.flaky || 0;

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
      };
    });
  }

  private async calculateTrendMetrics(
    displayReports: BackendReportHistory[],
    allReportsForBaseline: BackendReportHistory[]
  ): Promise<TrendMetrics> {
    const durationTrend = displayReports.map((report) => ({
      date: new Date(report.createdAt).toISOString(),
      duration: report.duration || 0,
    }));

    const flakyCounts = await Promise.all(
      displayReports.map(async (report) => ({
        date: new Date(report.createdAt).toISOString(),
        count: report.stats?.flaky || 0,
      }))
    );

    const slowThreshold = await this.calculateSlowThreshold(allReportsForBaseline);
    const slowCounts = await Promise.all(
      displayReports.map(async (report) => {
        const slowCount = await this.countSlowTests(report, slowThreshold);
        return {
          date: new Date(report.createdAt).toISOString(),
          count: slowCount,
        };
      })
    );

    return {
      durationTrend,
      flakyCountTrend: flakyCounts,
      slowCountTrend: slowCounts,
    };
  }

  private async extractTestDurations(reports: BackendReportHistory[]): Promise<number[]> {
    const durations: number[] = [];

    for (const report of reports) {
      if (!report.files) continue;

      for (const file of report.files) {
        if (!file.tests) continue;

        for (const test of file.tests) {
          if (test.duration) {
            durations.push(test.duration);
          }
        }
      }
    }

    return durations;
  }

  private async findSlowestSteps(
    reports: BackendReportHistory[],
    limit: number
  ): Promise<Array<{ step: string; duration: number; testId: string }>> {
    const steps: Array<{ step: string; duration: number; testId: string }> = [];

    for (const report of reports) {
      if (!report.files) continue;

      for (const file of report.files) {
        if (!file.tests) continue;

        for (const test of file.tests) {
          if (test.duration && test.title) {
            steps.push({
              step: test.title,
              duration: test.duration,
              testId: test.testId || file.fileName || 'unknown',
            });
          }
        }
      }
    }

    return steps.sort((a, b) => b.duration - a.duration).slice(0, limit);
  }

  private async calculatePreviousPassRate(reports: BackendReportHistory[]): Promise<number> {
    if (reports.length === 0) return 0;

    const totalExecuted = reports.reduce(
      (sum, report) =>
        sum +
        (report.stats?.expected || 0) +
        (report.stats?.unexpected || 0) +
        (report.stats?.flaky || 0),
      0
    );
    const totalPassed = reports.reduce((sum, report) => sum + (report.stats?.expected || 0), 0);

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

  private async calculateSlowThreshold(reports: BackendReportHistory[]): Promise<number> {
    const durations = await this.extractTestDurations(reports);
    if (durations.length === 0) return 1000; // Default 1 second

    durations.sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);
    return durations[p95Index] || 1000;
  }

  private async countSlowTests(report: BackendReportHistory, threshold: number): Promise<number> {
    if (!report.files) return 0;

    let count = 0;
    for (const file of report.files) {
      if (!file.tests) continue;

      for (const test of file.tests) {
        if (test.duration && test.duration > threshold) {
          count++;
        }
      }
    }

    return count;
  }

  async getTestTrends(testId: string, projectName?: string): Promise<StepTimingTrend | null> {
    const testReports = reportDb.getReportHistoryByTestId(testId, projectName);

    if (!testReports.length) {
      return null;
    }

    const runs: Array<{ runId: string; runDate: Date; duration: number; isOutlier: boolean }> = [];
    const durations: number[] = [];

    for (const report of testReports) {
      for (const file of report.files || []) {
        for (const test of file.tests || []) {
          const currentTestId = test.testId || `${file.fileName}:${test.title}`;

          if (currentTestId === testId && test.duration) {
            durations.push(test.duration);
            runs.push({
              runId: report.reportID,
              runDate: new Date(report.createdAt),
              duration: test.duration,
              isOutlier: false,
            });
          }
        }
      }
    }

    if (durations.length === 0) {
      return null;
    }

    durations.sort((a, b) => a - b);
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

    let testName = 'Unknown Test';
    for (const report of testReports) {
      for (const file of report.files || []) {
        for (const test of file.tests || []) {
          const currentTestId = test.testId || `${file.fileName}:${test.title}`;
          if (currentTestId === testId && test.title) {
            testName = test.title;
            break;
          }
        }
        if (testName !== 'Unknown Test') break;
      }
      if (testName !== 'Unknown Test') break;
    }

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
