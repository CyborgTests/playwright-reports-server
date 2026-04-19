import type { TestManagementConfig } from '@playwright-reports/shared';
import { ReportTestOutcomeEnum } from '@playwright-reports/shared';
import { defaultConfig } from '../config.js';
import { llmService } from '../llm/index.js';
import type { ReportHistory } from '../storage/types.js';
import { llmTasksDb } from './db/llmTasks.sqlite.js';
import type { Test, TestRun, TestWithQuarantineInfo } from './db/tests.sqlite.js';
import { testDb } from './db/tests.sqlite.js';
import { service } from './index.js';

export class TestManagementService {
  private config: TestManagementConfig | null = null;

  private async getConfig(): Promise<TestManagementConfig> {
    if (this.config) {
      return this.config;
    }

    const cfg = await service.getConfig();
    const testManagementCfg = cfg.testManagement || {};

    this.config = {
      quarantineThresholdPercentage: testManagementCfg.quarantineThresholdPercentage ?? 5,
      warningThresholdPercentage: testManagementCfg.warningThresholdPercentage ?? 2,
      autoQuarantineEnabled: testManagementCfg.autoQuarantineEnabled ?? false,
      flakinessMinRuns: testManagementCfg.flakinessMinRuns ?? 1,
      flakinessEvaluationWindowDays: testManagementCfg.flakinessEvaluationWindowDays ?? 30,
    };

    this.config.quarantineThresholdPercentage ??=
      defaultConfig.testManagement?.quarantineThresholdPercentage;
    this.config.warningThresholdPercentage ??=
      defaultConfig.testManagement?.warningThresholdPercentage;
    this.config.autoQuarantineEnabled ??= defaultConfig.testManagement?.autoQuarantineEnabled;
    this.config.flakinessMinRuns ??= defaultConfig.testManagement?.flakinessMinRuns;
    this.config.flakinessEvaluationWindowDays ??=
      defaultConfig.testManagement?.flakinessEvaluationWindowDays;

    return this.config;
  }

  public invalidateConfigCache(): void {
    this.config = null;
  }
  async processReport(report: ReportHistory): Promise<void> {
    console.log(
      `[testManagement] Processing report ${report.reportID} for project ${report.project}`
    );
    if (!report.files) return;

    const config = await this.getConfig();

    const transaction = () => {
      for (const file of report.files!) {
        if (!file.tests) continue;

        for (const test of file.tests) {
          const testId = test.testId ?? '';
          const fileId = file.fileId ?? '';
          const filePath = file.fileName ?? 'unknown';

          testDb.createTest({
            testId,
            fileId,
            filePath,
            project: report.project,
            title: test.title || 'Unknown Test',
          });

          const latestTestRun = testDb.getLatestTestRun(testId, fileId, report.project);

          const shouldQuarantineNextRun = latestTestRun
            ? latestTestRun?.quarantined && !latestTestRun?.fixedAt
            : false;

          const isFailedTest = test.outcome === 'unexpected' || test.outcome === 'failed' || test.outcome === 'flaky';
          const failureDetails = isFailedTest ? this.extractFailureDetails(test, filePath, 1) : null;
          const errorSignature = failureDetails
            ? this.computeErrorSignature(test.results?.[0]?.message || '', filePath)
            : null;

          const testRun = {
            runId: undefined,
            testId,
            fileId,
            project: report.project,
            reportId: report.reportID,
            outcome: test.outcome || 'unknown',
            duration: test.duration,
            createdAt: test.createdAt ?? new Date().toISOString(),
            quarantined: shouldQuarantineNextRun,
            quarantineReason: latestTestRun?.quarantineReason ?? '',
            flakinessScore: this.calculateFlakinessSync(testId, fileId, report.project, config),
            failureDetails: failureDetails ?? undefined,
            failureCategory: undefined, // populated by LLM later
            errorSignature: errorSignature ?? undefined,
          };

          if (
            //TODO: test automatic quarantine feature
            // considering case when test is removed from quarantine but score is still high
            config.autoQuarantineEnabled &&
            testRun.flakinessScore >= (config.quarantineThresholdPercentage ?? 5) &&
            testRun.quarantined
          ) {
            console.log(
              `[testManagement] Auto-quarantining testId=${testId} due to flakinessScore=${testRun.flakinessScore.toFixed(1)}%`
            );
            testRun.quarantined = true;
            testRun.quarantineReason = `Auto-quarantined due to ${testRun.flakinessScore.toFixed(1)}% flakiness over treshold ${config.quarantineThresholdPercentage ?? 5}%`;
          }

          testDb.createTestRun(testRun);
        }
      }
    };

    try {
      testDb.runTransaction(transaction);
    } catch (error) {
      console.error('[testManagement] Error processing report:', error);
      throw new Error(
        `Failed to process report: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    // After the transaction, queue LLM analysis for failed tests
    if (llmService.isConfigured()) {
      this.queueLlmAnalysis(report.reportID, report.project);
    }
  }

  private queueLlmAnalysis(reportId: string, project: string): void {
    try {
      // Get all test runs for this report that have failure details
      const allRuns = testDb.getTestRunsByReport(reportId);
      const failedRuns = allRuns.filter((run) => run.failureDetails);

      if (failedRuns.length === 0) {
        console.log(`[testManagement] No failed tests in report ${reportId}, skipping LLM analysis`);
        return;
      }

      for (const run of failedRuns) {
        llmTasksDb.createTask('test_analysis', {
          reportId,
          testId: run.testId,
          fileId: run.fileId,
          project,
          priority: 0,
        });
      }

      // Queue report summary — low priority so test analyses are processed first
      llmTasksDb.createTask('report_summary', {
        reportId,
        project,
        priority: -1,
      });

      console.log(`[testManagement] Queued ${failedRuns.length} LLM analysis tasks for report ${reportId}`);
    } catch (error) {
      console.error('[testManagement] Failed to queue LLM analysis:', error);
    }
  }

  private extractFailureDetails(
    test: { title: string; results?: Array<{ status?: string; message?: string; attachments?: Array<{ name: string; contentType: string; path: string }> }>; location?: { file: string; line: number; column: number }; attachments?: Array<{ name: string; path: string; contentType: string }> },
    filePath: string,
    attempt: number
  ): string | null {
    const result = test.results?.[attempt - 1];
    if (!result || result.status === 'passed') return null;

    const details = {
      message: result.message || '',
      stackTrace: undefined as string | undefined, // Playwright puts stack in message
      testTitle: test.title,
      filePath,
      location: test.location,
      attachments: result.attachments || test.attachments,
      attempt,
      status: result.status || 'unknown',
    };

    // Try to split message from stack trace (Playwright includes stack in message)
    if (details.message) {
      const stackIndex = details.message.indexOf('\n    at ');
      if (stackIndex > 0) {
        details.stackTrace = details.message.substring(stackIndex);
        details.message = details.message.substring(0, stackIndex);
      }
    }

    return JSON.stringify(details);
  }

  private computeErrorSignature(message: string, filePath: string): string {
    // Strip line numbers, variable values, timestamps for grouping
    const normalized = message
      .replace(/\d+/g, 'N')           // numbers → N
      .replace(/['"][^'"]*['"]/g, 'S') // quoted strings → S
      .replace(/\s+/g, ' ')           // normalize whitespace
      .trim()
      .substring(0, 500);             // limit length

    // Simple hash combining normalized message + file path
    let hash = 0;
    const input = `${filePath}:${normalized}`;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  private calculateFlakinessSync(
    testId: string,
    fileId: string,
    project: string,
    config: TestManagementConfig
  ): number {
    const windowDays =
      config.flakinessEvaluationWindowDays ??
      defaultConfig.testManagement?.flakinessEvaluationWindowDays;
    const minRuns = config.flakinessMinRuns ?? defaultConfig.testManagement?.flakinessMinRuns;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - windowDays!);

    // Returned in DESC order — reverse to get oldest-first for transition counting
    const recentRuns = testDb
      .getRecentTestRunsForFlakiness(testId, fileId, project, cutoffDate.toISOString())
      .reverse();

    if (recentRuns.length < minRuns! || recentRuns.length <= 1) return 0;

    // Classify each run as pass or fail
    const isPass = (outcome: string): boolean =>
      outcome === ReportTestOutcomeEnum.Expected || outcome === 'passed';

    // Count distinct instability events:
    // - A "flaky" outcome from Playwright (with retries) = 1 event
    // - A group of consecutive failures surrounded by passes = 1 event
    // - Leading failures (before any pass) are not flaky — just failures
    // A test that reliably fails or reliably passes has 0 events = 0% flaky.
    let events = 0;
    let inFailStreak = false;
    let seenPass = false;

    for (const { outcome } of recentRuns) {
      if (outcome === ReportTestOutcomeEnum.Flaky) {
        events++;
        seenPass = true; // flaky implies it passed on retry
        inFailStreak = false;
        continue;
      }

      if (isPass(outcome)) {
        seenPass = true;
        inFailStreak = false;
      } else if (seenPass && !inFailStreak) {
        events++;
        inFailStreak = true;
      }
    }

    return (events / recentRuns.length) * 100;
  }

  async updateQuarantineStatus(
    testId: string,
    fileId: string,
    project: string,
    isQuarantined: boolean,
    reason?: string
  ): Promise<void> {
    const latestRun = testDb.getLatestTestRun(testId, fileId, project);

    if (!latestRun) {
      throw new Error('No test run found for the specified test');
    }

    const updated = testDb.updateLatestTestRun(
      testId,
      fileId,
      project,
      isQuarantined,
      isQuarantined ? reason : undefined
    );

    if (!updated) {
      throw new Error('Failed to update test run quarantine status');
    }
  }

  async getTests(
    project?: string,
    options?: {
      status?: 'all' | 'quarantined' | 'not-quarantined';
      flakinessMin?: number;
      flakinessMax?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ data: TestWithQuarantineInfo[]; total: number }> {
    let tests = testDb.getAllAndDerivedData(project);

    if (options) {
      if (options.status && options.status !== 'all') {
        const shouldBeQuarantined = options.status === 'quarantined';
        tests = tests.filter((test) => test.isQuarantined === shouldBeQuarantined);
      }

      if (options.flakinessMin !== undefined || options.flakinessMax !== undefined) {
        const min = Math.max(0, options.flakinessMin ?? 0);
        const max = Math.min(100, options.flakinessMax ?? 100);
        tests = tests.filter((test) => {
          const score = test.flakinessScore || 0;
          return score >= min && score <= max;
        });
      }
    }

    // Sort: skipped last, unexpected first, high flakiness, low pass rate
    tests.sort((a, b) => {
      const latestOutcome = (t: TestWithQuarantineInfo) => t.runs?.[0]?.outcome ?? '';
      const aSkipped = latestOutcome(a) === 'skipped';
      const bSkipped = latestOutcome(b) === 'skipped';
      if (aSkipped !== bSkipped) return aSkipped ? 1 : -1;

      const aUnexpected = latestOutcome(a) === 'unexpected';
      const bUnexpected = latestOutcome(b) === 'unexpected';
      if (aUnexpected !== bUnexpected) return aUnexpected ? -1 : 1;

      const aFlakiness = a.flakinessScore ?? 0;
      const bFlakiness = b.flakinessScore ?? 0;
      if (Math.abs(aFlakiness - bFlakiness) > 0.01) return bFlakiness - aFlakiness;

      const getPassRate = (t: TestWithQuarantineInfo) => {
        if (!t.runs || t.runs.length === 0) return 1;
        return t.runs.filter((r) => r.outcome === 'expected' || r.outcome === 'passed').length / t.runs.length;
      };
      return getPassRate(a) - getPassRate(b);
    });

    const total = tests.length;

    if (options?.limit !== undefined) {
      const offset = options.offset ?? 0;
      tests = tests.slice(offset, offset + options.limit);
    }

    return { data: tests, total };
  }

  async getTestsSummary(
    project?: string,
    warningThreshold = 2
  ): Promise<{ total: number; flakyCount: number }> {
    const { total, flakyTests } = testDb.getTestsSummary(project);
    const flakyCount = flakyTests.filter(
      (t) => (t.flakinessScore ?? 0) >= warningThreshold
    ).length;
    return { total, flakyCount };
  }

  async getTest(
    testId: string,
    fileId: string,
    project: string
  ): Promise<(Test & { runs: TestRun[] }) | null> {
    const test = testDb.getTest(testId, fileId, project);
    if (!test) return null;

    const runs = testDb.getTestRuns(testId, fileId, project);

    return {
      ...test,
      runs,
    };
  }

  async getTestWithQuarantineInfo(
    testId: string,
    fileId: string,
    project: string
  ): Promise<TestWithQuarantineInfo | null> {
    return testDb.getTestWithDerivedData(testId, fileId, project) || null;
  }

  async deleteTest(testId: string, fileId: string, project: string): Promise<void> {
    testDb.deleteTest(testId, fileId, project);
    testDb.deleteTestRuns(testId, fileId, project);
  }

  async recalculateAllFlakinessScores(): Promise<number> {
    this.invalidateConfigCache();
    const config = await this.getConfig();
    const tests = testDb.getAllTests();
    let updated = 0;

    const transaction = () => {
      for (const test of tests) {
        const latestRun = testDb.getLatestTestRun(test.testId, test.fileId, test.project);
        if (!latestRun) continue;

        const newScore = this.calculateFlakinessSync(
          test.testId,
          test.fileId,
          test.project,
          config
        );

        if (latestRun.flakinessScore !== newScore) {
          testDb.updateFlakinessScore(latestRun.runId, newScore);
          updated++;
        }
      }
    };

    testDb.runTransaction(transaction);
    console.log(`[testManagement] Recalculated flakiness scores: ${updated} test(s) updated`);
    return updated;
  }
}

export const testManagementService = new TestManagementService();
