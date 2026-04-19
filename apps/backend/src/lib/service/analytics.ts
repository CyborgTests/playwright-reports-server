import type {
  AnalyticsData,
  OverviewStats,
  RunHealthMetric,
  StepTimingTrend,
  TrendMetrics,
} from '@playwright-reports/shared';
import type { ReportHistory as BackendReportHistory } from '../storage/types.js';
import { reportDb } from './db/reports.sqlite.js';
import { testDb } from './db/tests.sqlite.js';
import { service } from './index.js';

export class AnalyticsService {
  async getAnalyticsData(project?: string): Promise<AnalyticsData> {
    const reports = await this.getRecentReports(project);

    return {
      overviewStats: await this.calculateOverviewStats(reports, project),
      runHealthMetrics: await this.calculateRunHealthMetrics(reports),
      trendMetrics: await this.calculateTrendMetrics(reports),
    };
  }

  private async getRecentReports(project?: string): Promise<BackendReportHistory[]> {
    if (project) {
      return reportDb.getByProject(project);
    }
    return reportDb.getAll();
  }

  private async calculateOverviewStats(reports: BackendReportHistory[], project?: string): Promise<OverviewStats> {
    const recentReports = reports.slice(0, 30); // Last 30 runs
    const olderReports = reports.slice(30, 60); // Previous 30 runs for comparison

    const totalTests = recentReports.reduce((sum, report) => sum + (report.stats?.total || 0), 0);

    const totalPassed = recentReports.reduce(
      (sum, report) => sum + (report.stats?.expected || 0),
      0
    );
    const passRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;

    const flakyTests = await this.identifyFlakyTests(recentReports, project);

    const testDurations = await this.extractTestDurations(recentReports);
    const averageTestDuration =
      testDurations.length > 0
        ? testDurations.reduce((sum, duration) => sum + duration, 0) / testDurations.length
        : 0;

    const slowestSteps = await this.findSlowestSteps(recentReports, 10);

    const averageTestRunDuration =
      recentReports.reduce((sum, report) => sum + (report.duration || 0), 0) / recentReports.length;

    const currentPassRate = passRate;
    const olderPassRate = await this.calculatePreviousPassRate(olderReports);
    const passRateTrend = this.calculateTrend(currentPassRate, olderPassRate, 2); // 2% threshold
    const flakyTestsTrend: 'up' | 'down' | 'stable' = 'stable';

    return {
      totalTests,
      passRate: Math.round(passRate * 100) / 100,
      flakyTests: flakyTests.length,
      averageTestDuration: Math.round(averageTestDuration),
      slowestSteps,
      averageTestRunDuration,
      passRateTrend,
      flakyTestsTrend,
    };
  }

  private async calculateRunHealthMetrics(
    reports: BackendReportHistory[]
  ): Promise<RunHealthMetric[]> {
    return reports.slice(0, 20).map((report) => {
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
      };
    });
  }

  private async calculateTrendMetrics(reports: BackendReportHistory[]): Promise<TrendMetrics> {
    const recentReports = reports.slice(0, 30);

    const durationTrend = recentReports.map((report) => ({
      date: new Date(report.createdAt).toISOString(),
      duration: report.duration || 0,
    }));

    const flakyCounts = await Promise.all(
      recentReports.map(async (report) => ({
        date: new Date(report.createdAt).toISOString(),
        count: report.stats?.flaky || 0,
      }))
    );

    const slowThreshold = await this.calculateSlowThreshold(recentReports);
    const slowCounts = await Promise.all(
      recentReports.map(async (report) => {
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

  private async identifyFlakyTests(_reports: BackendReportHistory[], project?: string): Promise<string[]> {
    const config = await service.getConfig();
    const warningThreshold = config.testManagement?.warningThresholdPercentage ?? 2;
    const allTests = testDb.getAllAndDerivedData(project);
    return allTests
      .filter((t) => (t.flakinessScore ?? 0) >= warningThreshold)
      .map((t) => t.testId);
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

    const totalTests = reports.reduce((sum, report) => sum + (report.stats?.total || 0), 0);
    const totalPassed = reports.reduce((sum, report) => sum + (report.stats?.expected || 0), 0);

    return totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;
  }

  private calculateTrend(
    current: number,
    previous: number,
    threshold: number
  ): 'up' | 'down' | 'stable' {
    const difference = current - previous;
    const percentChange = previous > 0 ? (difference / previous) * 100 : 0;

    if (Math.abs(percentChange) < threshold || Math.abs(difference) < threshold) {
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
      console.log(`[analytics] No historical data found for testId: ${testId}`);
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
              isOutlier: false, // to be determined
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

    // define outliers
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
