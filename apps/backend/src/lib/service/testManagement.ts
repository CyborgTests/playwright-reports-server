import type {
  TestCrossProjectOccurrence,
  TestDetail,
  TestDetailStats,
  TestDurationStats,
  TestFailureGroup,
  TestManagementConfig,
} from '@playwright-reports/shared';
import { FLAKINESS_THRESHOLDS, ReportTestOutcomeEnum } from '@playwright-reports/shared';
import { defaultConfig } from '../config.js';
import { llmService } from '../llm/index.js';
import { extractFailureEvidence } from '../parser/failure-extraction.js';
import type { ReportHistory } from '../storage/types.js';
import { getDatabase } from './db/db.js';
import { llmTasksDb } from './db/llmTasks.sqlite.js';
import { projectSummaryDb } from './db/projectSummary.sqlite.js';
import type { Test, TestRun, TestWithQuarantineInfo } from './db/tests.sqlite.js';
import { testDb } from './db/tests.sqlite.js';
import { service } from './index.js';

/**
 * Compute flakiness score (% of runs that triggered an instability event) from an
 * oldest-first sequence of run outcomes. Mirrors the algorithm in calculateFlakinessSync.
 */
export function computeFlakinessFromOutcomes(
  runs: Array<{ outcome: ReportTestOutcomeEnum | string }>,
  minRuns = 1
): number {
  if (runs.length < minRuns || runs.length <= 1) return 0;

  const isPass = (outcome: string): boolean =>
    outcome === ReportTestOutcomeEnum.Expected || outcome === 'passed';

  let events = 0;
  let inFailStreak = false;
  let seenPass = false;

  for (const { outcome } of runs) {
    if (outcome === ReportTestOutcomeEnum.Flaky) {
      events++;
      seenPass = true;
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

  return (events / runs.length) * 100;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length - 1) * p));
  return sortedAsc[idx];
}

function buildDurationStats(runs: TestRun[]): TestDurationStats | undefined {
  const durations = runs
    .map((r) => r.duration)
    .filter((d): d is number => typeof d === 'number' && d >= 0);
  if (durations.length === 0) return undefined;

  const sorted = [...durations].sort((a, b) => a - b);
  const mean = sorted.reduce((s, d) => s + d, 0) / sorted.length;
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
  const variance = sorted.reduce((s, d) => s + (d - mean) ** 2, 0) / sorted.length;
  return {
    mean: Math.round(mean),
    median: Math.round(median),
    p95: Math.round(percentile(sorted, 0.95)),
    stdDev: Math.round(Math.sqrt(variance)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function buildTestDetailStats(runs: TestRun[]): TestDetailStats {
  let passed = 0;
  let failed = 0;
  let flaky = 0;
  let skipped = 0;
  for (const run of runs) {
    switch (run.outcome) {
      case ReportTestOutcomeEnum.Expected:
      case 'passed':
        passed++;
        break;
      case ReportTestOutcomeEnum.Flaky:
        flaky++;
        break;
      case ReportTestOutcomeEnum.Skipped:
      case 'skipped':
        skipped++;
        break;
      default:
        failed++;
        break;
    }
  }
  const executed = passed + failed + flaky;
  const passRate = executed > 0 ? Math.round(((passed + flaky) / executed) * 10000) / 100 : 0;
  const sortedByDateAsc = [...runs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  return {
    totalRuns: runs.length,
    passed,
    failed,
    flaky,
    skipped,
    passRate,
    firstRunAt: sortedByDateAsc.at(0)?.createdAt,
    lastRunAt: sortedByDateAsc.at(-1)?.createdAt,
    duration: buildDurationStats(runs),
  };
}

function buildFailureGroups(runs: TestRun[]): TestFailureGroup[] {
  const groups = new Map<
    string,
    {
      signature: string;
      category?: string;
      sampleMessage: string;
      runs: TestRun[];
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
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT project, fileId FROM tests
       WHERE testId = ? AND project != ?
       GROUP BY project, fileId`
    )
    .all(testId, excludeProject) as Array<{ project: string; fileId: string }>;

  const occurrences: TestCrossProjectOccurrence[] = [];
  for (const { project, fileId } of rows) {
    const derived = testDb.getTestWithDerivedData(testId, fileId, project);
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

/**
 * Canonical failure-category enum. Order is significant for UI display and LLM prompts.
 */
export const FAILURE_CATEGORIES = [
  'timeout',
  'element_not_visible',
  'element_not_found',
  'assertion_error',
  'snapshot_mismatch',
  'network_error',
  'api_error',
  'authentication_error',
  'navigation_error',
  'browser_crash',
  'setup_teardown',
  'javascript_error',
  'unknown',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

const KNOWN_CATEGORIES = new Set<string>(FAILURE_CATEGORIES);

export function isKnownCategory(value: string | undefined | null): value is FailureCategory {
  return !!value && KNOWN_CATEGORIES.has(value);
}

/**
 * Detect failure category from a Playwright error message via anchored, ordered patterns.
 * Most-specific shapes match first; ambiguous inputs fall through to `unknown` rather than
 * being mis-labelled. Used as the baseline; LLM and signature-consensus layers may override.
 */
export function detectFailureCategory(errorMessage: string): FailureCategory {
  if (!errorMessage) return 'unknown';
  const msg = errorMessage.trim();
  const lower = msg.toLowerCase();

  // Extract leading error class name when Playwright prefixes the message.
  // e.g. "TimeoutError: locator.click: Timeout 30000ms exceeded."
  const errorNameMatch = msg.match(/^([A-Z][A-Za-z]*Error)\b/);
  const errorName = errorNameMatch?.[1];

  // 1. Browser/page lifecycle issues — check before network so "browser closed" doesn't slip into network.
  if (
    /Target page, context or browser has been closed/.test(msg) ||
    /Page (?:crashed|closed)/.test(msg) ||
    /browser has (?:disconnected|been closed)/i.test(msg) ||
    /Execution context (?:was destroyed|is unavailable)/.test(msg)
  ) {
    return 'browser_crash';
  }

  // 2. Snapshot / visual-regression — explicit Playwright phrasing.
  if (
    /Screenshot comparison failed/.test(msg) ||
    /toHaveScreenshot|toMatchSnapshot/.test(msg) ||
    /pixels?\s+\(?ratio/.test(msg)
  ) {
    return 'snapshot_mismatch';
  }

  // 3. Network transport — explicit `net::ERR_*` or low-level socket errors.
  if (
    /net::ERR_[A-Z_]+/.test(msg) ||
    /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/.test(msg)
  ) {
    return 'network_error';
  }

  // 4. Setup/teardown — error originates inside a hook or fixture.
  if (
    /\b(?:beforeAll|afterAll|beforeEach|afterEach)\b/.test(msg) ||
    /Error in fixture\b/.test(msg) ||
    /Worker process (?:exited|crashed)/.test(msg)
  ) {
    return 'setup_teardown';
  }

  // 5. Assertion-shaped failures — distinguish "element didn't appear" from "value mismatch".
  //    Playwright's web-first assertions emit `expect(locator).toBeVisible()` etc.; if the
  //    failure also mentions a timeout, the locator never resolved — bucket as element_not_visible.
  const isExpect = /\bexpect\s*\(/.test(msg);
  if (isExpect) {
    if (
      /\.(?:toBeVisible|toBeAttached|toBeEnabled|toBeFocused|toBeInViewport|toContainText|toHaveText|toHaveValue|toHaveCount|toHaveAttribute|toBeChecked)\b/.test(
        msg
      ) &&
      /Timed? out|Timeout/i.test(msg)
    ) {
      return 'element_not_visible';
    }
    if (
      /\.(?:toEqual|toBe|toMatch|toContain|toStrictEqual|toHaveLength|toBeTruthy|toBeFalsy|toBeNull|toBeDefined|toBeGreaterThan|toBeLessThan|toBeCloseTo)\b/.test(
        msg
      )
    ) {
      return 'assertion_error';
    }
  }

  // 6. Locator failures — strict-mode violations or "resolved to 0 elements".
  if (
    /resolved to 0 elements/.test(msg) ||
    /strict mode violation/i.test(msg) ||
    /locator\.\w+: .*not found/i.test(msg) ||
    /No node found for selector/.test(msg)
  ) {
    return 'element_not_found';
  }

  // 7. Timeouts — the typed TimeoutError class, or test-level timeout messages.
  if (
    errorName === 'TimeoutError' ||
    /^Test timeout of \d+ms exceeded/.test(msg) ||
    /\bTimeout \d+ms exceeded\b/.test(msg) ||
    /exceeded the maximum/i.test(lower)
  ) {
    return 'timeout';
  }

  // 8. Navigation — page.goto or frame navigation, when not already classified as network.
  if (
    /page\.(?:goto|reload|goBack|goForward):/.test(msg) ||
    /Navigation (?:failed|timeout|to .+ was interrupted)/i.test(msg) ||
    /frame (?:was )?detached/i.test(msg)
  ) {
    return 'navigation_error';
  }

  // 9. HTTP API failures — explicit 4xx/5xx mention, narrow to avoid false positives.
  const statusCodeMatch = msg.match(/\bstatus(?:\s+code)?[:\s]+(\d{3})\b/i);
  if (statusCodeMatch) {
    const status = Number(statusCodeMatch[1]);
    if (status === 401 || status === 403) return 'authentication_error';
    if (status >= 400) return 'api_error';
  }
  if (/\bHTTP\s+(?:4|5)\d{2}\b/.test(msg)) {
    return 'api_error';
  }

  // 10. Authentication keywords — only when paired with explicit auth/identity context.
  if (
    /\b(?:Unauthorized|Forbidden)\b/.test(msg) ||
    /\b401\b|\b403\b/.test(msg) ||
    /(?:authentication|login|credentials) (?:failed|required|invalid)/i.test(msg)
  ) {
    return 'authentication_error';
  }

  // 11. JS runtime errors thrown inside the page under test.
  if (
    /^(?:ReferenceError|SyntaxError|TypeError):/.test(msg) ||
    /Uncaught \(in promise\)/.test(msg) ||
    /page\.evaluate(?:Handle)?:/.test(msg)
  ) {
    return 'javascript_error';
  }

  return 'unknown';
}

const CONSENSUS_MIN_OBSERVATIONS = 3;
const CONSENSUS_MIN_SHARE = 0.7;

/**
 * Classify a failure with provenance. Order:
 *   1. If `errorSignature` has a strong historical consensus → use it (`'consensus'`).
 *   2. Otherwise → run the heuristic (`'heuristic'`).
 *
 * The LLM layer may override afterwards (see llmAnalysisQueue).
 */
export function classifyFailure(
  errorMessage: string,
  errorSignature: string | null
): { category: FailureCategory; source: 'heuristic' | 'consensus' } {
  if (errorSignature) {
    const consensus = testDb.getCategoryConsensus(errorSignature);
    if (
      consensus &&
      isKnownCategory(consensus.category) &&
      consensus.total >= CONSENSUS_MIN_OBSERVATIONS &&
      consensus.share >= CONSENSUS_MIN_SHARE
    ) {
      return { category: consensus.category, source: 'consensus' };
    }
  }
  return { category: detectFailureCategory(errorMessage), source: 'heuristic' };
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

    // Pre-extract failure details for every failed attempt (async — may read
    // trace ZIPs and error-context files from disk). Done OUTSIDE the SQL
    // transaction so the transaction stays sync and short.
    type PreparedFailure = {
      details: string;
      message: string;
      signature: string;
      signatureGlobal: string;
      classification: { category: FailureCategory; source: 'heuristic' | 'consensus' };
    };
    const preparedByKey = new Map<string, PreparedFailure>();
    for (const file of report.files) {
      if (!file.tests) continue;
      for (const test of file.tests) {
        const isFailedTest =
          test.outcome === 'unexpected' || test.outcome === 'failed' || test.outcome === 'flaky';
        if (!isFailedTest) continue;
        const testId = test.testId ?? '';
        const fileId = file.fileId ?? '';
        const filePath = file.fileName ?? 'unknown';
        const details = await this.extractFailureDetails(test, filePath, 1, report.reportID);
        if (!details) continue;
        let message = '';
        try {
          message = String(JSON.parse(details).message ?? '');
        } catch {
          /* ignore */
        }
        const signature = this.computeErrorSignature(message, filePath);
        const signatureGlobal = this.computeErrorSignature(message);
        const classification = classifyFailure(message, signature);
        preparedByKey.set(`${testId}::${fileId}`, {
          details,
          message,
          signature,
          signatureGlobal,
          classification,
        });
      }
    }

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

          const prepared = preparedByKey.get(`${testId}::${fileId}`);
          const failureDetails = prepared?.details ?? null;
          const errorSignature = prepared?.signature ?? null;
          const errorSignatureGlobal = prepared?.signatureGlobal ?? null;
          const classification = prepared?.classification ?? null;

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
              (report.startTime
                ? new Date(report.startTime).toISOString()
                : report.createdAt instanceof Date
                  ? report.createdAt.toISOString()
                  : report.createdAt),
            quarantined: shouldQuarantineNextRun,
            quarantineReason: latestTestRun?.quarantineReason ?? '',
            flakinessScore: this.calculateFlakinessSync(testId, fileId, report.project, config),
            failureDetails: failureDetails ?? undefined,
            failureCategory: classification?.category,
            failureCategorySource: classification?.source,
            errorSignature: errorSignature ?? undefined,
            errorSignatureGlobal: errorSignatureGlobal ?? undefined,
          };

          if (
            //TODO: test automatic quarantine feature
            // considering case when test is removed from quarantine but score is still high
            config.autoQuarantineEnabled &&
            testRun.flakinessScore >=
              (config.quarantineThresholdPercentage ??
                FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE) &&
            testRun.quarantined
          ) {
            console.log(
              `[testManagement] Auto-quarantining testId=${testId} due to flakinessScore=${testRun.flakinessScore.toFixed(1)}%`
            );
            testRun.quarantined = true;
            testRun.quarantineReason = `Auto-quarantined due to ${testRun.flakinessScore.toFixed(1)}% flakiness over treshold ${config.quarantineThresholdPercentage ?? FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE}%`;
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

    // Invalidate any persisted project-level LLM summaries — they describe the latest 10
    // runs, so once a new report exists for this project, the cached summary is stale.
    // 'all' covers the dashboard case where no project filter was selected.
    projectSummaryDb.deleteByProject(report.project);
    projectSummaryDb.deleteByProject('all');

    // After the transaction, queue LLM analysis for failed tests — but only if the user
    // opted in via Settings → LLM Configuration → "Auto-analyze new reports". Default off
    // so deployments don't burn LLM tokens unprompted.
    if (llmService.isConfigured()) {
      const cfg = await service.getConfig();
      if (cfg.llm?.autoAnalyzeNewReports) {
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

      // Queue report summary — low priority so test analyses are processed first
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

    // Pull the full evidence payload: canonical error message + stack, page
    // snapshot from the error-context attachment, and sanitized console /
    // network / action events from the trace ZIP. Persisted alongside the
    // legacy message/stack fields so the LLM queue can render dedicated
    // segments without re-parsing the trace.
    const evidence = await extractFailureEvidence(reportId, test, result);

    // Build the full retry timeline so the LLM can reason about flaky-vs-persistent
    // directly. Single-line message summaries keep this compact even with many retries.
    const attempts = (test.results ?? []).map((r, idx) => {
      const summary =
        r.status === 'passed'
          ? undefined
          : (r.message ?? '').replace(/\s+/g, ' ').trim().substring(0, 300) || undefined;
      return {
        attempt: idx + 1,
        status: r.status ?? 'unknown',
        message: summary,
        durationMs: typeof r.duration === 'number' ? r.duration : undefined,
      };
    });

    // Persist message + stackTrace as flat fields for backward compatibility
    // with the heuristic classifier (which only reads `message`). The full
    // evidence payload is nested under `evidence` for the LLM prompt builder.
    const details = {
      message: evidence.errorMessage,
      stackTrace: evidence.stackTrace,
      testTitle: test.title,
      filePath,
      location: test.location,
      attachments: result.attachments || test.attachments,
      attempt,
      status: result.status || 'unknown',
      attempts: attempts.length > 0 ? attempts : undefined,
      evidence,
    };

    return JSON.stringify(details);
  }

  public computeErrorSignature(message: string, filePath?: string): string {
    // Strip numbers, quoted strings, and excess whitespace so the same root failure groups together.
    const normalized = message
      .replace(/\d+/g, 'N')
      .replace(/['"][^'"]*['"]/g, 'S')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 500);

    let hash = 0;
    const input = filePath !== undefined ? `${filePath}:${normalized}` : normalized;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  public backfillGlobalSignatures(): number {
    return testDb.backfillGlobalSignatures((message) => this.computeErrorSignature(message));
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

    return computeFlakinessFromOutcomes(recentRuns, minRuns ?? 1);
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
      tiers?: Array<'stable' | 'flaky' | 'critical'>;
      sort?: 'default' | 'slowest';
      failureCategory?: string;
      limit?: number;
      offset?: number;
      from?: string;
      to?: string;
      search?: string;
    }
  ): Promise<{ data: TestWithQuarantineInfo[]; total: number }> {
    let tests = testDb.getAllAndDerivedData(project);

    if (options?.from || options?.to) {
      const from = options.from ?? '0001-01-01T00:00:00Z';
      const to = options.to ?? new Date(Date.now() + 60_000).toISOString();
      const windowedRuns = testDb.getTestRunsInWindow(project, from, to);

      const grouped = new Map<string, TestRun[]>();
      for (const run of windowedRuns) {
        const key = `${run.testId}::${run.fileId}::${run.project}`;
        let bucket = grouped.get(key);
        if (!bucket) {
          bucket = [];
          grouped.set(key, bucket);
        }
        bucket.push(run);
      }

      tests = tests
        .filter((t) => grouped.has(`${t.testId}::${t.fileId}::${t.project}`))
        .map((t) => {
          const runs = grouped.get(`${t.testId}::${t.fileId}::${t.project}`) ?? [];
          return {
            ...t,
            runs,
            totalRuns: runs.length,
          };
        });
    }

    if (options) {
      if (options.status && options.status !== 'all') {
        const shouldBeQuarantined = options.status === 'quarantined';
        tests = tests.filter((test) => test.isQuarantined === shouldBeQuarantined);
      }

      if (options.tiers && options.tiers.length > 0) {
        const cfg = await this.getConfig();
        const warning = cfg.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
        const quarantine =
          cfg.quarantineThresholdPercentage ?? FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE;
        const matchesTier = (score: number, tier: string) => {
          switch (tier) {
            case 'stable':
              return score < warning;
            case 'flaky':
              return score >= warning && score < quarantine;
            case 'critical':
              return score >= quarantine;
            default:
              return false;
          }
        };
        tests = tests.filter((test) => {
          const score = test.flakinessScore ?? 0;
          return options.tiers!.some((tier) => matchesTier(score, tier));
        });
      }

      if (options.failureCategory) {
        const target = options.failureCategory;
        tests = tests.filter((test) =>
          (test.runs ?? []).some((run) => run.failureCategory === target)
        );
      }

      if (options.search) {
        const term = options.search.toLowerCase();
        tests = tests.filter(
          (test) =>
            test.title.toLowerCase().includes(term) || test.filePath.toLowerCase().includes(term)
        );
      }
    }

    if (options?.sort === 'slowest') {
      const avgDuration = (t: TestWithQuarantineInfo) => {
        const durations = (t.runs ?? [])
          .map((r) => r.duration)
          .filter((d): d is number => typeof d === 'number' && d >= 0);
        if (durations.length === 0) return -1;
        return durations.reduce((s, d) => s + d, 0) / durations.length;
      };
      tests.sort((a, b) => avgDuration(b) - avgDuration(a));
      const total = tests.length;
      if (options.limit !== undefined) {
        const offset = options.offset ?? 0;
        tests = tests.slice(offset, offset + options.limit);
      }
      return { data: tests, total };
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
        return (
          t.runs.filter((r) => r.outcome === 'expected' || r.outcome === 'passed').length /
          t.runs.length
        );
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
    warningThreshold: number = FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE,
    opts?: { from?: string; to?: string }
  ): Promise<{ total: number; flakyCount: number }> {
    if (opts?.from || opts?.to) {
      const from = opts.from ?? '0001-01-01T00:00:00Z';
      const to = opts.to ?? new Date(Date.now() + 60_000).toISOString();
      const runs = testDb.getTestRunOutcomesInWindow(project, from, to);

      const lanesInWindow = new Set<string>();
      const uniqueTestIds = new Set<string>();
      for (const run of runs) {
        uniqueTestIds.add(run.testId);
        lanesInWindow.add(`${run.testId}::${run.fileId}::${run.project}`);
      }

      const flakyTestIds = new Set<string>();
      for (const test of testDb.getAllAndDerivedData(project)) {
        const key = `${test.testId}::${test.fileId}::${test.project}`;
        if (!lanesInWindow.has(key)) continue;
        if ((test.flakinessScore ?? 0) >= warningThreshold) {
          flakyTestIds.add(test.testId);
        }
      }

      return { total: uniqueTestIds.size, flakyCount: flakyTestIds.size };
    }

    const { total, flakyTests } = testDb.getTestsSummary(project, warningThreshold);
    const flakyTestIds = new Set<string>(flakyTests.map((t) => t.testId));
    return { total, flakyCount: flakyTestIds.size };
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

  async getTestDetail(testId: string, fileId: string, project: string): Promise<TestDetail | null> {
    const test = testDb.getTestWithDerivedData(testId, fileId, project);
    if (!test) return null;

    const runs = testDb.getTestRuns(testId, fileId, project);
    const stats = buildTestDetailStats(runs);
    const failureGroups = buildFailureGroups(runs);
    const crossProject = buildCrossProjectOccurrences(testId, project);

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
      stats,
      runs,
      failureGroups,
      crossProject,
    };
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
