import type {
  TestCrossProjectOccurrence,
  TestDetail,
  TestDetailStats,
  TestDurationStats,
  TestFailureGroup,
  TestManagementConfig,
} from '@playwright-reports/shared';
import { FLAKINESS_THRESHOLDS, ReportTestOutcomeEnum } from '@playwright-reports/shared';
import { defaultConfig } from '../../config.js';
import { llmService } from '../../llm/index.js';
import { extractFailureEvidence } from '../../parser/failure-extraction.js';
import type { ReportHistory } from '../../storage/types.js';
import {
  llmTasksDb,
  regressionsDb,
  type Test,
  type TestDetailStatsAggregate,
  type TestRunRow,
  type TestWithQuarantineInfoRow,
  testAnalyticsDb,
  testDb,
  testQueriesDb,
  toRegressionContext,
} from '../db/index.js';
import { service } from '../index.js';
import { computeErrorSignature } from './error-signature.js';
import { classifyFailure } from './failure-classifier.js';
import { computeFlakinessFromOutcomes } from './flakiness.js';

function toTestDetailStats(row: TestDetailStatsAggregate): TestDetailStats {
  const totalRuns = row.totalRuns ?? 0;
  const passed = row.passed ?? 0;
  const flaky = row.flaky ?? 0;
  const skipped = row.skipped ?? 0;
  const failed = Math.max(0, totalRuns - passed - flaky - skipped);
  const executed = passed + failed + flaky;
  const passRate = executed > 0 ? Math.round(((passed + flaky) / executed) * 10000) / 100 : 0;

  let duration: TestDurationStats | undefined;
  if (row.durCount > 0 && row.mean != null) {
    const variance = Math.max(0, row.variance ?? 0);
    duration = {
      mean: Math.round(row.mean),
      median: Math.round(row.median ?? row.mean),
      p95: Math.round(row.p95 ?? row.maxD ?? 0),
      stdDev: Math.round(Math.sqrt(variance)),
      min: row.minD ?? 0,
      max: row.maxD ?? 0,
    };
  }

  return {
    totalRuns,
    passed,
    failed,
    flaky,
    skipped,
    passRate,
    firstRunAt: row.firstRunAt ?? undefined,
    lastRunAt: row.lastRunAt ?? undefined,
    duration,
  };
}

function buildFailureGroups(runs: TestRunRow[]): TestFailureGroup[] {
  const groups = new Map<
    string,
    {
      signature: string;
      category?: string;
      sampleMessage: string;
      runs: TestRunRow[];
    }
  >();
  for (const run of runs) {
    const sig = run.errorSignature;
    const isFailure =
      run.outcome !== ReportTestOutcomeEnum.Expected &&
      run.outcome !== ReportTestOutcomeEnum.Skipped &&
      run.outcome !== 'passed' &&
      run.outcome !== 'skipped';
    if (!sig || !isFailure) continue;

    let bucket = groups.get(sig);
    if (!bucket) {
      let sampleMessage = '';
      if (run.failureDetails) {
        try {
          sampleMessage = String(JSON.parse(run.failureDetails)?.message ?? '');
        } catch {
          sampleMessage = '';
        }
      }
      bucket = {
        signature: sig,
        category: run.failureCategory,
        sampleMessage,
        runs: [],
      };
      groups.set(sig, bucket);
    }
    bucket.runs.push(run);
  }

  return Array.from(groups.values())
    .map((g) => {
      const sortedAsc = [...g.runs].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const sortedDesc = [...sortedAsc].reverse();
      return {
        signature: g.signature,
        category: g.category,
        count: g.runs.length,
        sampleMessage: g.sampleMessage,
        firstSeen: sortedAsc[0].createdAt,
        lastSeen: sortedDesc[0].createdAt,
        recentReports: sortedDesc.slice(0, 5).map((r) => ({
          reportId: r.reportId,
          title: r.reportTitle,
          displayNumber: r.reportDisplayNumber,
        })),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function buildCrossProjectOccurrences(
  testId: string,
  excludeProject: string
): TestCrossProjectOccurrence[] {
  const rows = testDb.findTestSiblings(testId, excludeProject);

  const occurrences: TestCrossProjectOccurrence[] = [];
  for (const { project, fileId } of rows) {
    const derived = testQueriesDb.getTestWithDerivedData(testId, fileId, project);
    if (!derived) continue;
    occurrences.push({
      project,
      fileId,
      totalRuns: derived.totalRuns ?? 0,
      flakinessScore: derived.flakinessScore,
      isQuarantined: !!derived.isQuarantined,
      lastRunAt: derived.lastRunAt,
    });
  }
  return occurrences.sort((a, b) => (b.flakinessScore ?? 0) - (a.flakinessScore ?? 0));
}

export class TestManagementService {
  private config: TestManagementConfig | null = null;

  private async getConfig(): Promise<TestManagementConfig> {
    if (this.config) {
      return this.config;
    }

    const cfg = await service.getConfig();
    const testManagementCfg = cfg.testManagement || {};

    this.config = {
      quarantineThresholdPercentage:
        testManagementCfg.quarantineThresholdPercentage ??
        FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE,
      warningThresholdPercentage:
        testManagementCfg.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE,
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

    type PreparedFailure = {
      details: string;
      message: string;
      signature: string;
      classification: {
        category: import('@playwright-reports/shared').FailureCategory;
        source: 'heuristic' | 'consensus';
      };
    };
    const preparedByKey = new Map<string, PreparedFailure>();

    type ExtractJob = {
      key: string;
      test: NonNullable<typeof report.files>[number]['tests'] extends Array<infer T> ? T : never;
      filePath: string;
    };
    const jobs: ExtractJob[] = [];
    for (const file of report.files) {
      if (!file.tests) continue;
      for (const test of file.tests) {
        const isFailedTest =
          test.outcome === 'unexpected' || test.outcome === 'failed' || test.outcome === 'flaky';
        if (!isFailedTest) continue;
        const testId = test.testId ?? '';
        const fileId = file.fileId ?? '';
        const filePath = file.fileName ?? 'unknown';
        jobs.push({ key: `${testId}::${fileId}`, test: test as ExtractJob['test'], filePath });
      }
    }

    const CONCURRENCY = 8;
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const chunk = jobs.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((job) => this.extractFailureDetails(job.test, job.filePath, 1, report.reportID))
      );
      for (let j = 0; j < chunk.length; j++) {
        const details = results[j];
        if (!details) continue;
        const job = chunk[j];
        let message = '';
        try {
          message = String(JSON.parse(details).message ?? '');
        } catch {
          /* ignore */
        }
        const signature = computeErrorSignature(message, job.filePath);
        const classification = classifyFailure(message, signature);
        preparedByKey.set(job.key, {
          details,
          message,
          signature,
          classification,
        });
      }
    }

    const reportMetadata = (report as { metadata?: { gitCommit?: { hash?: string } } }).metadata;
    const currentReportCommit: string | null = reportMetadata?.gitCommit?.hash ?? null;

    const files = report.files;
    const transaction = () => {
      for (const file of files) {
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

          const state = testDb.getTestState(testId, fileId, report.project);
          const stayQuarantined = state
            ? state.quarantined === 1 && !state.quarantineFixedAt
            : false;

          const prepared = preparedByKey.get(`${testId}::${fileId}`);
          const failureDetails = prepared?.details ?? null;
          const errorSignature = prepared?.signature ?? null;
          const classification = prepared?.classification ?? null;

          const hasTrace =
            (test.attachments ?? []).some((a) => a?.name === 'trace') ||
            (test.results ?? []).some((r) =>
              (r.attachments ?? []).some((a) => a?.name === 'trace')
            );

          const testRun = {
            runId: undefined,
            testId,
            fileId,
            project: report.project,
            reportId: report.reportID,
            outcome: test.outcome || 'unknown',
            duration: test.duration,
            createdAt:
              test.createdAt ??
              (report.startTime ? new Date(report.startTime).toISOString() : report.createdAt),
            failureDetails: failureDetails ?? undefined,
            failureCategory: classification?.category,
            failureCategorySource: classification?.source,
            errorSignature: errorSignature ?? undefined,
            hasTrace,
          };

          const { runId } = testDb.createTestRun(testRun);
          const laneRuns = testDb.getLaneRunsForRefresh(testId, fileId, report.project);
          const priorRuns = laneRuns.filter((r) => r.runId !== runId);
          const flakinessScore = this.computeFlakinessForRuns(
            testId,
            fileId,
            report.project,
            priorRuns,
            state?.flakinessResetAt,
            config
          );
          testDb.refreshTestStatColsFromRuns(
            testId,
            fileId,
            report.project,
            laneRuns,
            flakinessScore
          );

          const quarantineThreshold =
            config.quarantineThresholdPercentage ?? FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE;
          if (
            config.autoQuarantineEnabled &&
            !stayQuarantined &&
            flakinessScore >= quarantineThreshold
          ) {
            console.log(
              `[testManagement] Auto-quarantining testId=${testId} due to flakinessScore=${flakinessScore.toFixed(1)}%`
            );
            testDb.setQuarantineState(
              testId,
              fileId,
              report.project,
              true,
              `Auto-quarantined due to ${flakinessScore.toFixed(1)}% flakiness over threshold ${quarantineThreshold}%`
            );
          }
        }
      }
      regressionsDb.detectForReport(report.reportID, currentReportCommit);
    };

    try {
      testDb.runTransaction(transaction);
    } catch (error) {
      console.error('[testManagement] Error processing report:', error);
      throw new Error(
        `Failed to process report: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    if (llmService.isConfigured()) {
      const cfg = await service.getConfig();
      if (cfg.llm?.featureEnabled !== false && cfg.llm?.autoAnalyzeNewReports) {
        this.queueLlmAnalysis(report.reportID, report.project);
      }
    }
  }

  private queueLlmAnalysis(reportId: string, project: string): void {
    try {
      const allRuns = testDb.getTestRunsByReport(reportId);
      const failedRuns = allRuns.filter((run) => run.failureDetails);

      if (failedRuns.length === 0) {
        console.log(
          `[testManagement] No failed tests in report ${reportId}, skipping LLM analysis`
        );
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

      llmTasksDb.createTask('report_summary', {
        reportId,
        project,
        priority: -1,
      });

      console.log(
        `[testManagement] Queued ${failedRuns.length} LLM analysis tasks for report ${reportId}`
      );
    } catch (error) {
      console.error('[testManagement] Failed to queue LLM analysis:', error);
    }
  }

  private async extractFailureDetails(
    test: {
      testId?: string;
      title: string;
      outcome?: string;
      results?: Array<{
        status?: string;
        message?: string;
        duration?: number;
        attachments?: Array<{ name: string; contentType: string; path: string }>;
      }>;
      location?: { file: string; line: number; column: number };
      attachments?: Array<{ name: string; path: string; contentType: string }>;
    },
    filePath: string,
    attempt: number,
    reportId: string
  ): Promise<string | null> {
    const result = test.results?.[attempt - 1];
    if (!result || result.status === 'passed') return null;

    const evidence = await extractFailureEvidence(reportId, test, result);

    const attempts = (test.results ?? []).map((r, idx) => {
      const summary =
        r.status === 'passed'
          ? undefined
          : (r.message ?? '').replace(/\s+/g, ' ').trim().substring(0, 300) || undefined;
      return {
        attempt: idx + 1,
        status: r.status || test.outcome || 'unknown',
        message: summary,
        durationMs: typeof r.duration === 'number' ? r.duration : undefined,
      };
    });

    const details = {
      message: evidence.errorMessage,
      stackTrace: evidence.stackTrace,
      testTitle: test.title,
      filePath,
      location: test.location,
      attachments: result.attachments || test.attachments,
      attempt,
      status: result.status || test.outcome || 'failed',
      attempts: attempts.length > 0 ? attempts : undefined,
      evidence,
    };

    return JSON.stringify(details);
  }

  private computeFlakinessForRuns(
    testId: string,
    fileId: string,
    project: string,
    runsDesc: Array<{ outcome: string; createdAt: string }>,
    flakinessResetAt: string | null | undefined,
    config: TestManagementConfig
  ): number {
    const windowDays =
      config.flakinessEvaluationWindowDays ??
      defaultConfig.testManagement?.flakinessEvaluationWindowDays;
    const minRuns = config.flakinessMinRuns ?? defaultConfig.testManagement?.flakinessMinRuns;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (windowDays ?? 30));
    let effectiveCutoff = cutoffDate.toISOString();

    if (flakinessResetAt) {
      if (flakinessResetAt < effectiveCutoff) {
        testDb.setFlakinessResetAt(testId, fileId, project, null);
      } else if (flakinessResetAt > effectiveCutoff) {
        effectiveCutoff = flakinessResetAt;
      }
    }

    const windowed = runsDesc
      .filter((r) => r.outcome !== 'skipped' && r.createdAt >= effectiveCutoff)
      .reverse();

    return computeFlakinessFromOutcomes(windowed, minRuns ?? 1);
  }

  private calculateFlakinessSync(
    testId: string,
    fileId: string,
    project: string,
    config: TestManagementConfig,
    flakinessResetAt: string | null | undefined
  ): number {
    const runs = testDb.getLaneRunsForRefresh(testId, fileId, project);
    return this.computeFlakinessForRuns(testId, fileId, project, runs, flakinessResetAt, config);
  }

  async resetFlakiness(testId: string, fileId: string, project: string): Promise<void> {
    const test = testDb.getTest(testId, fileId, project);
    if (!test) {
      throw new Error('Test not found');
    }

    const config = await this.getConfig();
    const now = new Date().toISOString();

    testDb.runTransaction(() => {
      testDb.setFlakinessResetAt(testId, fileId, project, now);

      const latestRun = testDb.getLatestTestRun(testId, fileId, project);
      if (latestRun) {
        const newScore = this.calculateFlakinessSync(testId, fileId, project, config, now);
        testDb.setFlakinessScore(testId, fileId, project, newScore);
      }
    });
  }

  async clearFlakinessReset(testId: string, fileId: string, project: string): Promise<void> {
    const test = testDb.getTest(testId, fileId, project);
    if (!test) {
      throw new Error('Test not found');
    }

    const config = await this.getConfig();

    testDb.runTransaction(() => {
      testDb.setFlakinessResetAt(testId, fileId, project, null);

      const latestRun = testDb.getLatestTestRun(testId, fileId, project);
      if (latestRun) {
        const newScore = this.calculateFlakinessSync(testId, fileId, project, config, null);
        testDb.setFlakinessScore(testId, fileId, project, newScore);
      }
    });
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

    const updated = testDb.setQuarantineState(
      testId,
      fileId,
      project,
      isQuarantined,
      isQuarantined ? reason : undefined
    );

    if (!updated) {
      throw new Error('Failed to update test quarantine status');
    }

    if (isQuarantined && regressionsDb.hasOpenForTest(testId, fileId, project)) {
      regressionsDb.closeOpenForTest({
        testId,
        fileId,
        project,
        recoveredAtReportId: latestRun.reportId,
        recoveredAtCreatedAt: latestRun.createdAt,
        recoveredAtCommit: null,
      });
    }
  }

  async getTests(
    project?: string,
    options?: {
      status?: 'all' | 'quarantined' | 'not-quarantined';
      tiers?: Array<'stable' | 'flaky' | 'critical'>;
      sort?: 'default' | 'slowest' | 'stale' | 'regression-age';
      failureCategory?: string;
      limit?: number;
      offset?: number;
      from?: string;
      to?: string;
      search?: string;
      regressedOnly?: boolean;
      regressedSince?: string;
      resolvedSince?: string;
      slim?: boolean;
    }
  ): Promise<{ data: TestWithQuarantineInfoRow[]; total: number }> {
    let tierOpt:
      | {
          warningThreshold: number;
          quarantineThreshold: number;
          tiers: Array<'stable' | 'flaky' | 'critical'>;
        }
      | undefined;
    if (options?.tiers && options.tiers.length > 0) {
      const cfg = await this.getConfig();
      tierOpt = {
        warningThreshold: cfg.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE,
        quarantineThreshold:
          cfg.quarantineThresholdPercentage ?? FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE,
        tiers: options.tiers,
      };
    }

    const { rows, total } = testQueriesDb.getDerivedPage(project, {
      status: options?.status,
      sort: options?.sort,
      tier: tierOpt,
      failureCategory: options?.failureCategory,
      limit: options?.limit,
      offset: options?.offset,
      from: options?.from,
      to: options?.to,
      search: options?.search,
      regressedOnly: options?.regressedOnly,
      regressedSince: options?.regressedSince,
      resolvedSince: options?.resolvedSince,
    });

    if (rows.length === 0) return { data: [], total };

    const skipRuns = options?.slim === true;
    const runsByKey = skipRuns
      ? undefined
      : testQueriesDb.getRunsForLanes(
          rows.map((r) => ({ testId: r.testId, fileId: r.fileId, project: r.project })),
          options?.from || options?.to ? { from: options?.from, to: options?.to } : undefined
        );

    const data: TestWithQuarantineInfoRow[] = rows.map((row) => {
      const key = `${row.testId}::${row.fileId}::${row.project}`;
      const isQuarantined = Boolean(row.quarantined);
      return {
        testId: row.testId,
        fileId: row.fileId,
        filePath: row.filePath,
        project: row.project,
        title: row.title,
        createdAt: row.createdAt,
        totalRuns: row.totalRuns,
        lastRunAt: row.lastRunAt ?? undefined,
        flakinessScore: row.flakinessScore ?? undefined,
        flakinessResetAt: row.flakinessResetAt ?? undefined,
        isQuarantined,
        quarantinedAt: isQuarantined && row.latestNonSkippedAt ? row.latestNonSkippedAt : undefined,
        quarantineReason: isQuarantined && row.quarantineReason ? row.quarantineReason : undefined,
        runs: runsByKey?.get(key) ?? [],
      };
    });

    return { data, total };
  }

  async getTestsSummary(
    project?: string,
    warningThreshold: number = FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE,
    opts?: { from?: string; to?: string }
  ): Promise<{ total: number; flakyCount: number }> {
    if (opts?.from || opts?.to) {
      const from = opts.from ?? '0001-01-01T00:00:00Z';
      const to = opts.to ?? new Date(Date.now() + 60_000).toISOString();
      return testAnalyticsDb.getFlakySummaryInWindow(project, from, to, warningThreshold);
    }

    const { total, flakyTests } = testQueriesDb.getTestsSummary(project, warningThreshold);
    const flakyTestIds = new Set<string>(flakyTests.map((t) => t.testId));
    return { total, flakyCount: flakyTestIds.size };
  }

  async getTest(
    testId: string,
    fileId: string,
    project: string
  ): Promise<(Test & { runs: TestRunRow[] }) | null> {
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
  ): Promise<TestWithQuarantineInfoRow | null> {
    return testQueriesDb.getTestWithDerivedData(testId, fileId, project) || null;
  }

  async getTestDetail(testId: string, fileId: string, project: string): Promise<TestDetail | null> {
    let resolvedProject = project;
    if (!project || project === 'all') {
      const canonical = testDb.findTestByIds(testId, fileId);
      if (!canonical) return null;
      resolvedProject = canonical.project;
    }

    const test = testQueriesDb.getTestWithDerivedData(testId, fileId, resolvedProject);
    if (!test) return null;

    const runs = testDb.getTestRuns(testId, fileId, resolvedProject);
    const stats = toTestDetailStats(
      testQueriesDb.getTestDetailStatsAggregate(testId, fileId, resolvedProject)
    );
    const failureGroups = buildFailureGroups(runs);
    const crossProject = buildCrossProjectOccurrences(testId, resolvedProject);
    const openRegression = regressionsDb.getOpenForTest(testId, fileId, resolvedProject);

    return {
      testId: test.testId,
      fileId: test.fileId,
      filePath: test.filePath,
      project: test.project,
      title: test.title,
      createdAt: test.createdAt,
      isQuarantined: !!test.isQuarantined,
      quarantineReason: test.quarantineReason,
      quarantinedAt: test.quarantinedAt,
      flakinessScore: test.flakinessScore,
      flakinessResetAt: test.flakinessResetAt,
      stats,
      runs,
      failureGroups,
      crossProject,
      regression: openRegression ? toRegressionContext(openRegression) : undefined,
    };
  }

  async getTestRunsPage(
    testId: string,
    project: string,
    opts: { before?: string; limit?: number }
  ): Promise<TestRunRow[] | null> {
    const lane = testDb.findByTestId(testId, project && project !== 'all' ? project : undefined);
    if (!lane) return null;
    return testQueriesDb.getTestRunPointsPage(lane.testId, lane.fileId, lane.project, opts);
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
        const state = testDb.getTestState(test.testId, test.fileId, test.project);
        if (!state) continue;

        const newScore = this.calculateFlakinessSync(
          test.testId,
          test.fileId,
          test.project,
          config,
          state.flakinessResetAt
        );

        if (state.flakinessScore !== newScore) {
          testDb.setFlakinessScore(test.testId, test.fileId, test.project, newScore);
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
