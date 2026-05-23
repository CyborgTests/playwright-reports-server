import fs from 'node:fs/promises';
import path from 'node:path';
import type { ClusterStrategy } from '@playwright-reports/shared';
import { FLAKINESS_THRESHOLDS } from '@playwright-reports/shared';
import { llmService } from '../llm/index.js';
import {
  parseProjectAnalysisFromText,
  parseProjectAnalysisStructured,
  pruneInvalidCodeRefs,
  renderProjectAnalysisAsMarkdown,
} from '../llm/projectAnalysis.js';
import type {
  FailureDetailsForPrompt,
  ProjectCluster,
  ProjectCoverageScope,
  ProjectTrendSignal,
  ProjectTrendWindow,
  ReportSummaryTrendContext,
} from '../llm/prompts/index.js';
import {
  type AttemptSummary,
  buildProjectSummarySegments,
  buildReportSummarySegments,
  buildTestFailureSegments,
  extractRootCauseParagraph,
  fitPromptToBudget,
  PROJECT_ANALYSIS_SCHEMA,
  REPORT_ANALYSIS_SCHEMA,
  renderSegmentsForDebug,
  TEST_FAILURE_ANALYSIS_SCHEMA,
  unescapeLiteralNewlines,
} from '../llm/prompts/index.js';
import {
  parseReportAnalysisFromText,
  parseReportAnalysisStructured,
  renderReportAnalysisAsMarkdown,
} from '../llm/reportAnalysis.js';
import { halveEscapedBackslashes } from '../llm/structured-analysis-utils.js';
import type { SegmentedPrompt } from '../llm/types/index.js';
import {
  extractFailureEvidence,
  type FailureEvidence,
  stripAnsi,
} from '../parser/failure-extraction.js';
import { parseHtmlReport } from '../parser/index.js';
import { REPORTS_FOLDER } from '../storage/constants.js';
import { analysisFeedbackDb } from './db/analysisFeedback.sqlite.js';
import { getDatabase } from './db/db.js';
import { failureSummaryDb } from './db/failureSummary.sqlite.js';
import type { LlmTaskRow } from './db/llmTasks.sqlite.js';
import { llmTasksDb } from './db/llmTasks.sqlite.js';
import { projectSummaryDb } from './db/projectSummary.sqlite.js';
import { testAnalysisDb } from './db/testAnalysis.sqlite.js';
import { testDb } from './db/tests.sqlite.js';
import { service } from './index.js';
import { compareReports, findPreviousReportInProject } from './reportCompare.js';

export const PROJECT_SUMMARY_REPORT_LIMIT = 20;

/** Per-task output-token reserve used by fitToContextWindow. Each value
 *  reflects the rough cap on how much markdown each task type tends to
 *  produce: test-analysis is one diagnosis (~800–1500 tokens out, 4000 is
 *  generous); report-summary is three sections of markdown across a run;
 *  project-summary is verdict + ≤4 sections across the latest N runs and
 *  needs the most headroom. Tuned alongside the prompt templates in
 *  `prompts/index.ts`. */
const OUTPUT_RESERVE_TOKENS_BY_TASK = {
  testAnalysis: 4000,
  reportSummary: 6000,
  projectSummary: 8000,
} as const;
/** Generic fallback for callers (and existing default) when the caller
 *  doesn't tell `fitToContextWindow` what kind of task it's serving. */
const DEFAULT_OUTPUT_RESERVE_TOKENS = OUTPUT_RESERVE_TOKENS_BY_TASK.projectSummary;
const SAFETY_MARGIN_TOKENS = 1000;

/** Reuse-via-error-signature guards. Internal — not exposed via env or
 *  runtime config. Bumping these requires a code change so the trade-off
 *  (cost savings vs. analysis staleness) is reviewed deliberately.
 *  - TTL_DAYS: skip reuse when the prior analysis is older than this.
 *  - RECURRENCE_LIMIT: skip reuse when the same signature has recurred
 *    more than this many times since the prior analysis (signal that the
 *    failure is persistent, not transient — re-evaluate). */
const REUSE_TTL_DAYS = 7;
const REUSE_RECURRENCE_LIMIT = 5;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Per-task temperature defaults applied when the user has not configured an
 *  override in Settings. Cooler for test_analysis (better category accuracy);
 *  middling for summaries (some warmth helps synthesis phrasing). Exposed
 *  via /api/llm/defaults so the UI can show them as placeholders. */
export const TASK_TEMPERATURE_DEFAULTS = {
  testAnalysis: 0.2,
  reportSummary: 0.3,
  projectSummary: 0.3,
} as const;

async function readImageAttachment(
  reportId: string,
  att: { name: string; path: string; contentType: string }
): Promise<{ data: string; mediaType: string; source: string } | null> {
  if (!att.contentType?.startsWith('image/')) return null;
  try {
    const fullPath = path.join(REPORTS_FOLDER, reportId, att.path);
    const stat = await fs.stat(fullPath);
    if (stat.size > MAX_IMAGE_BYTES) {
      console.warn(
        `[llmQueue] image ${att.path} skipped (${stat.size}B > ${MAX_IMAGE_BYTES}B cap)`
      );
      return null;
    }
    const buf = await fs.readFile(fullPath);
    return { data: buf.toString('base64'), mediaType: att.contentType, source: att.path };
  } catch (err) {
    console.warn(
      `[llmQueue] failed to read image ${att.path}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/** Cross-project context tuning. Shared by `processTestAnalysis` and the
 *  user-driven `buildTestAnalysisRequest` so they pull the same candidate
 *  pool and keep the same N entries. */
const CROSS_PROJECT_CANDIDATE_POOL = 25;
const CROSS_PROJECT_KEEP = 5;

/** Caps on the recent-history lists rendered into the historical-context and
 *  flakiness-rationale segments. `runs` is loaded with LIMIT 50; these slice
 *  it further so a long-lived test doesn't dominate the prompt. */
const RECENT_OUTCOMES_KEEP = 15;
const RECENT_CATEGORIES_KEEP = 8;

/**
 * Build the cross-project context block input: same-test feedback in other
 * projects, scored by (a) signature match, (b) recency, (c) whether a prior
 * LLM analysis is attached. Returns the top N entries plus the total
 * candidate pool size so the prompt can say "+M more not shown."
 */
function buildCrossProjectEntries(
  testId: string,
  fileId: string,
  project: string,
  currentSignature: string | undefined
): {
  entries: Array<{
    project: string;
    comment: string;
    updatedAt: string;
    errorSignatureMatchesCurrent: boolean;
    latestAnalysis?: { content: string; updatedAt: string; model?: string };
  }>;
  totalCount: number;
} {
  const relatedRows = analysisFeedbackDb.getRelatedByTest(
    testId,
    fileId,
    project,
    CROSS_PROJECT_CANDIDATE_POOL
  );
  // Signature match dominates (>=100). Recency adds up to 30 (today=30, decays
  // toward 0 with age). Having a prior LLM analysis attached adds 5 (tiebreaker only).
  const score = (r: (typeof relatedRows)[number]): number => {
    const sigMatch =
      !!currentSignature && !!r.errorSignature && r.errorSignature === currentSignature;
    const ageMs = Date.now() - new Date(r.updatedAt).getTime();
    const days = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
    return (sigMatch ? 100 : 0) + 30 / (1 + days) + (r.latestAnalysis ? 5 : 0);
  };
  const ranked = [...relatedRows]
    .map((r) => ({ row: r, s: score(r) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, CROSS_PROJECT_KEEP)
    .map(({ row: r }) => r);
  const entries = ranked.map((r) => ({
    project: r.project,
    comment: r.comment,
    updatedAt: r.updatedAt,
    errorSignatureMatchesCurrent:
      !!currentSignature && !!r.errorSignature && r.errorSignature === currentSignature,
    latestAnalysis: r.latestAnalysis
      ? {
          content: r.latestAnalysis,
          updatedAt: r.latestAnalysisUpdatedAt ?? r.updatedAt,
          model: r.latestAnalysisModel ?? undefined,
        }
      : undefined,
  }));
  return { entries, totalCount: relatedRows.length };
}

/**
 * Extract recent outcome + previous-category sequences from the test's run
 * history. Both lists are most-recent first to match the historical-context
 * block's chronological rendering. Returns plain arrays — no async I/O.
 */
function buildRecentHistoryFromRuns(runs: ReturnType<typeof testDb.getTestRuns>): {
  recentOutcomes: string[];
  previousCategoriesChronological: string[];
} {
  const recentOutcomes = runs.slice(0, RECENT_OUTCOMES_KEEP).map((r) => r.outcome);
  const previousCategoriesChronological = runs
    .map((r) => r.failureCategory)
    .filter((c): c is string => !!c)
    .slice(0, RECENT_CATEGORIES_KEEP);
  return { recentOutcomes, previousCategoriesChronological };
}

/**
 * Merge report-level Playwright version into the trace-derived environment
 * (the trace doesn't carry the runner version). Best-effort lookup; failure
 * here is silent — environment is optional context. Mutates `details.evidence`
 * in place since we want both call sites to see the enrichment.
 */
/** Pre-PR evidence rows lack every payload-derived field and may still carry
 *  the old 4 KB truncation marker — re-extract from the report when detected. */
function isEvidenceStale(evidence: FailureEvidence | undefined): boolean {
  if (!evidence) return true;
  if (
    typeof evidence.pageSnapshot === 'string' &&
    evidence.pageSnapshot.endsWith('... (truncated)')
  ) {
    return true;
  }
  return !(
    evidence.testSourceFrame ||
    evidence.stepTree ||
    evidence.stdout ||
    evidence.stderr ||
    evidence.testMeta ||
    evidence.gitCommit ||
    evidence.ciBuild ||
    evidence.gitDiff
  );
}

/** Pre-PR extractor wrote `status: result.status ?? 'unknown'` and merged-blob
 *  reports leave `result.status` empty — every attempt came out 'unknown'. */
function areAttemptsStale(attempts: AttemptSummary[] | undefined): boolean {
  if (!attempts || attempts.length === 0) return true;
  return attempts.every((a) => !a.status || a.status === 'unknown');
}

async function enrichEnvironmentFromReport(
  details: FailureDetailsForPrompt,
  reportId: string
): Promise<void> {
  if (!details.evidence?.environment) return;
  if (details.evidence.environment.playwrightVersion) return;
  try {
    const { reportDb } = await import('./db/reports.sqlite.js');
    const reportRow = reportDb.getByID(reportId);
    const pwVersion = (reportRow?.metadata as { playwrightVersion?: string } | undefined)
      ?.playwrightVersion;
    if (pwVersion) {
      details.evidence = {
        ...details.evidence,
        environment: { ...details.evidence.environment, playwrightVersion: pwVersion },
      };
    }
  } catch {
    // ignore — environment is best-effort
  }
}

/**
 * Attach the first image attachment from the failure to the `current_failure`
 * segment of a built prompt. Multimodal mode + the LLMService's blocklist gate
 * whether the image actually goes on the wire; here we just stage it. Mutates
 * `builtPrompt.segments` so the caller can keep using the same reference.
 */
async function attachScreenshotIfAny(
  builtPrompt: SegmentedPrompt,
  details: FailureDetailsForPrompt,
  reportId: string,
  logPrefix?: string
): Promise<void> {
  const imageAtt = details.attachments?.find((a) => a.contentType?.startsWith('image/'));
  if (!imageAtt) return;
  const img = await readImageAttachment(reportId, imageAtt);
  if (!img) return;
  const failureIdx = builtPrompt.segments.findIndex((s) => s.id === 'current_failure');
  if (failureIdx < 0) return;
  builtPrompt.segments[failureIdx] = {
    ...builtPrompt.segments[failureIdx],
    images: [img],
  };
  if (logPrefix) {
    console.log(`${logPrefix}: attached screenshot ${imageAtt.path} (${img.mediaType})`);
  }
}

/** Last-resort char cap when no context window can be detected. ~30k chars
 *  is the rough cap a 24k-token local model will accept for input. */
const NO_CONTEXT_CHAR_FALLBACK = 30_000;

/**
 * Resize a segmented prompt to the model's context window if known, or to a
 * conservative char cap when the window is undetectable. Returns the (possibly
 * shrunk) prompt and a log message describing what was changed, if anything.
 */
async function fitToContextWindow(
  prompt: SegmentedPrompt,
  outputReserveTokens: number = DEFAULT_OUTPUT_RESERVE_TOKENS
): Promise<{ prompt: SegmentedPrompt; log: string | null }> {
  const window = await llmService.getContextWindow().catch(() => null);
  const tokens = await llmService.countTokens(prompt).catch(() => null);
  const totalChars = prompt.segments.reduce((sum, s) => sum + s.content.length, 0);

  if (!window) {
    // Unknown window — apply the conservative char cap.
    const fit = fitPromptToBudget(prompt, NO_CONTEXT_CHAR_FALLBACK);
    if (fit.changes.length === 0) return { prompt: fit.prompt, log: null };
    return {
      prompt: fit.prompt,
      log: `[no context window detected; cap=${NO_CONTEXT_CHAR_FALLBACK} chars] ${fit.changes.join(', ')}`,
    };
  }

  const inputBudgetTokens = window - outputReserveTokens - SAFETY_MARGIN_TOKENS;
  if (inputBudgetTokens <= 0 || tokens === null || tokens <= inputBudgetTokens) {
    return { prompt, log: null };
  }

  const charsPerToken = totalChars / tokens;
  const charsBudget = Math.floor(inputBudgetTokens * charsPerToken);
  const fit = fitPromptToBudget(prompt, charsBudget);

  if (fit.changes.length === 0) return { prompt: fit.prompt, log: null };
  return {
    prompt: fit.prompt,
    log: `[over budget: ${tokens}>${inputBudgetTokens} tokens] ${fit.changes.join(', ')}`,
  };
}

class LlmAnalysisQueue {
  private static instance: LlmAnalysisQueue;
  private running = false;
  private pollIntervalMs = 5000;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTasks = 0;
  private maxParallel = 1;

  static getInstance(): LlmAnalysisQueue {
    if (!LlmAnalysisQueue.instance) {
      LlmAnalysisQueue.instance = new LlmAnalysisQueue();
    }
    return LlmAnalysisQueue.instance;
  }

  private async getParallelRequests(): Promise<number> {
    try {
      const config = await service.getConfig();
      return (config as any)?.llm?.parallelRequests ?? 1;
    } catch {
      return 1;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[llmQueue] Starting queue processor');
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[llmQueue] Stopped queue processor');
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      if (llmService.isConfigured()) {
        this.maxParallel = await this.getParallelRequests();
        while (this.running && this.activeTasks < this.maxParallel) {
          if (!this.fillSlot()) break;
        }
      }
    } catch (error) {
      console.error('[llmQueue] Poll error:', error);
    }

    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
  }

  private fillSlot(): boolean {
    if (!this.running) return false;
    const [task] = llmTasksDb.claimNext(1);
    if (!task) return false;
    this.activeTasks++;
    this.dispatch(task);
    return true;
  }

  private dispatch(task: LlmTaskRow): void {
    void this.processTask(task)
      .catch((error) => {
        console.error(`[llmQueue] Unhandled error in task ${task.id}:`, error);
      })
      .finally(() => {
        this.activeTasks--;
        if (this.running && this.activeTasks < this.maxParallel) {
          this.fillSlot();
        }
      });
  }

  private async processTask(task: LlmTaskRow): Promise<void> {
    try {
      switch (task.type) {
        case 'test_analysis':
          await this.processTestAnalysis(task);
          break;
        case 'report_summary':
          await this.processReportSummary(task);
          break;
        case 'project_summary':
          await this.processProjectSummary(task);
          break;
        default:
          llmTasksDb.fail(task.id, `Unknown task type: ${task.type}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[llmQueue] Task ${task.id} failed:`, msg);
      llmTasksDb.fail(task.id, msg);
    }
  }

  private async processTestAnalysis(task: LlmTaskRow): Promise<void> {
    const { testId, fileId, project, reportId } = task;
    if (!testId || !fileId || !project || !reportId) {
      llmTasksDb.fail(task.id, 'Missing testId, fileId, project, or reportId');
      return;
    }

    const runs = testDb.getTestRuns(testId, fileId, project);
    const failedRun =
      runs.find((r) => r.failureDetails && r.reportId === reportId) ||
      runs.find((r) => r.failureDetails) ||
      runs.find((r) => r.reportId === reportId) ||
      runs[0];

    let details: FailureDetailsForPrompt;

    if (failedRun?.failureDetails) {
      try {
        details = JSON.parse(failedRun.failureDetails);
      } catch {
        llmTasksDb.fail(task.id, 'Failed to parse failure details JSON');
        return;
      }

      // Re-extract from the report when stored details are missing/stale.
      // Merged reports often leave message/attempts empty; pre-PR rows lack
      // the payload-derived evidence. Payload cache makes this cheap.
      const needsMessageEnrich = !details.message || details.message.trim() === '';
      const needsAttemptsEnrich = areAttemptsStale(details.attempts);
      const needsEvidenceEnrich = !details.evidence || isEvidenceStale(details.evidence);
      if (needsMessageEnrich || needsAttemptsEnrich || needsEvidenceEnrich) {
        const extracted = await this.extractDetailsFromReport(reportId, testId);
        if (extracted?.message && needsMessageEnrich) {
          details.message = extracted.message;
          details.stackTrace ??= extracted.stackTrace;
        }
        if (extracted?.attempts && needsAttemptsEnrich) {
          details.attempts = extracted.attempts;
        }
        if (extracted?.evidence && needsEvidenceEnrich) {
          details.evidence = extracted.evidence;
        }
      }
    } else {
      const extracted = await this.extractDetailsFromReport(reportId, testId);
      if (!extracted) {
        llmTasksDb.fail(
          task.id,
          `No failure details found — test ${testId} not found in report ${reportId}`
        );
        return;
      }
      details = extracted;
    }

    if (details.message) details.message = stripAnsi(details.message);
    if (details.stackTrace) details.stackTrace = stripAnsi(details.stackTrace);

    const totalRuns = testDb.getTestRunCount(testId, fileId, project);
    const recentFailures = runs.filter(
      (r) => r.outcome === 'unexpected' || r.outcome === 'failed'
    ).length;

    const previousAnalysis = testAnalysisDb.getByTest(testId, fileId, project);
    const isNewFailure = !previousAnalysis;

    const feedback = analysisFeedbackDb.getByTest(testId, fileId, project);

    // Compute the heuristic category up-front — needed for the strict reuse
    // match below. (It's also used later for the prompt build + LLM/heuristic
    // consensus rule)
    const { detectFailureCategory, isKnownCategory } = await import('./testManagement.js');
    const heuristicCategory = detectFailureCategory(details.message);

    // Reuse a prior analysis only when it is definitely the same failure AND
    // there is no analysis already covering the current (testId, reportId).
    // The match is strict: same testId/fileId/project AND identical
    // `error_signature` (the normalized hash from test_runs that strips
    // numbers + quoted strings) AND identical heuristic `failure_category`
    // AND the source row has non-empty analysis text. We exclude the current
    // report from the search so we never reuse a row from this same run.
    //
    // Five guards invalidate an otherwise-eligible reuse:
    //   1. User-driven retry (task.isRetry) — the user explicitly asked for a fresh run,
    //      typically after switching models. Reusing would echo the prior model name and
    //      analysis verbatim, defeating the point of the retry.
    //   2. Existing analysis for THIS (testId, reportId) is non-empty — re-running the
    //      task implies the user wants the row replaced; don't silently mirror something
    //      else over the top of an analysis they may already have read.
    //   3. Own-project feedback newer than the source analysis — otherwise feedback
    //      never reaches the model after the first generation.
    //   4. Source analysis older than REUSE_TTL_DAYS — environments drift; a "transient"
    //      diagnosis from last week may be a real bug today. Force a fresh look.
    //   5. Same error_signature has recurred more than REUSE_RECURRENCE_LIMIT times
    //      since the source analysis was created — strong signal that the issue is
    //      persistent, not transient, and deserves re-evaluation.
    const currentErrorSignature = failedRun?.errorSignature;
    const existingForThisReport = testAnalysisDb.getByTestAndReport(testId, reportId);
    const hasNonEmptyExisting =
      !!existingForThisReport?.analysis && existingForThisReport.analysis.trim().length > 0;
    if (!task.isRetry && !hasNonEmptyExisting && currentErrorSignature) {
      const db = getDatabase();
      const reuseSource = db
        .prepare(
          `SELECT tla.* FROM test_llm_analyses tla
           JOIN test_runs tr ON tr.testId = tla.testId
                            AND tr.fileId = tla.fileId
                            AND tr.project = tla.project
                            AND tr.reportId = tla.reportId
           WHERE tla.testId = ? AND tla.fileId = ? AND tla.project = ?
             AND tr.error_signature = ?
             AND tr.failure_category = ?
             AND tla.analysis IS NOT NULL
             AND TRIM(tla.analysis) != ''
             AND tla.reportId != ?
           ORDER BY datetime(COALESCE(tla.updatedAt, tla.createdAt)) DESC
           LIMIT 1`
        )
        .get(testId, fileId, project, currentErrorSignature, heuristicCategory, reportId) as
        | {
            id: string;
            analysis: string;
            category: string | null;
            model: string | null;
            createdAt: string;
            updatedAt: string | null;
          }
        | undefined;

      if (reuseSource) {
        const sourceUpdatedAt = reuseSource.updatedAt || reuseSource.createdAt;
        const feedbackIsNewer =
          feedback &&
          sourceUpdatedAt &&
          new Date(feedback.updatedAt).getTime() > new Date(sourceUpdatedAt).getTime();

        const ageMs = sourceUpdatedAt ? Date.now() - new Date(sourceUpdatedAt).getTime() : 0;
        const ttlExpired = ageMs > REUSE_TTL_DAYS * 24 * 60 * 60 * 1000;

        let recurrenceExceeded = false;
        if (sourceUpdatedAt) {
          const recurrenceRow = db
            .prepare(
              `SELECT COUNT(*) as count FROM test_runs
               WHERE testId = ? AND fileId = ? AND project = ?
                 AND error_signature = ? AND createdAt > ?`
            )
            .get(testId, fileId, project, currentErrorSignature, sourceUpdatedAt) as {
            count: number;
          };
          recurrenceExceeded = recurrenceRow.count > REUSE_RECURRENCE_LIMIT;
        }

        if (ttlExpired) {
          console.log(
            `[llmQueue] Task ${task.id}: source analysis older than ${REUSE_TTL_DAYS}d — forcing fresh analysis for test ${testId}`
          );
        } else if (recurrenceExceeded) {
          console.log(
            `[llmQueue] Task ${task.id}: signature recurred >${REUSE_RECURRENCE_LIMIT} times since source analysis — forcing fresh analysis for test ${testId}`
          );
        } else if (feedbackIsNewer) {
          console.log(
            `[llmQueue] Task ${task.id}: feedback newer than source analysis — forcing fresh analysis for test ${testId}`
          );
        } else {
          console.log(
            `[llmQueue] Task ${task.id}: error_signature + category match (source ${reuseSource.id}), reusing for test ${testId}`
          );
          const attempt = details.attempt ?? 1;
          // Reused = 0 tokens (no LLM call).
          const reuseExtras = {
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
          llmTasksDb.complete(
            task.id,
            reuseSource.analysis,
            reuseSource.category ?? undefined,
            reuseSource.model ?? undefined,
            reuseExtras
          );
          // Mark the new row as reused so consumers can show "♻ Reused" rather than
          // surface it as a fresh LLM-generated analysis.
          testAnalysisDb.upsert(
            testId,
            fileId,
            project,
            reportId,
            reuseSource.analysis,
            reuseSource.category ?? undefined,
            reuseSource.model ?? undefined,
            attempt,
            reuseSource.id,
            reuseExtras
          );

          if (failedRun?.runId && reuseSource.category) {
            testDb.updateFailureCategory(failedRun.runId, reuseSource.category);
          }

          if (reportId && llmTasksDb.areAllTestTasksComplete(reportId)) {
            console.log(`[llmQueue] All test analyses for report ${reportId} complete`);
          }
          return;
        }
      }
    }

    const config = await service.getConfig();
    const warningThreshold =
      (config as any)?.testManagement?.warningThresholdPercentage ??
      FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
    const flakinessScore = failedRun?.flakinessScore ?? 0;

    // Runtime prompt overrides from settings. Each override replaces the
    // corresponding baseline; mustache vars are substituted from a per-template
    // allowlist (see prompts/index.ts).
    const llmCfg = (config as any)?.llm ?? {};
    const promptOverrides = {
      systemPrompt: llmCfg.customSystemPrompt as string | undefined,
      testAnalysisSystemPrompt: llmCfg.customTestAnalysisSystemPrompt as string | undefined,
      projectSummarySystemPrompt: llmCfg.customProjectSummarySystemPrompt as string | undefined,
      testAnalysisInstructions: llmCfg.customTestAnalysisInstructions as string | undefined,
      reportSummaryPrompt: llmCfg.customReportSummaryPrompt as string | undefined,
      projectSummaryInstructions: llmCfg.customProjectSummaryInstructions as string | undefined,
      project,
      errorCategory: heuristicCategory,
    };

    // Same-test feedback in other projects — purely additive context that
    // does NOT invalidate reuse (the reuse guard above checks own-project only).
    const { entries: crossProjectEntries, totalCount: crossProjectTotalCount } =
      buildCrossProjectEntries(testId, fileId, project, failedRun?.errorSignature ?? undefined);

    const { recentOutcomes, previousCategoriesChronological } = buildRecentHistoryFromRuns(runs);

    await enrichEnvironmentFromReport(details, reportId);

    const priorPrior = testAnalysisDb.getLatestPriorByTest(testId, fileId, project, reportId);
    const builtPrompt = buildTestFailureSegments({
      failureDetails: details,
      historicalContext: {
        totalRuns,
        recentFailureCount: recentFailures,
        flakinessScore,
        flakinessThreshold: warningThreshold,
        isFlaky: flakinessScore >= warningThreshold,
        isNewFailure,
        recentOutcomes,
        previousCategories: previousCategoriesChronological,
      },
      feedback,
      crossProjectEntries,
      crossProjectTotalCount,
      priorInProjectAnalysis: priorPrior?.analysis
        ? {
            analysis: priorPrior.analysis,
            category: priorPrior.category ?? undefined,
            model: priorPrior.model ?? undefined,
            updatedAt: priorPrior.updatedAt ?? priorPrior.createdAt,
          }
        : null,
      overrides: promptOverrides,
    });

    // Attach the first image attachment (screenshot) — regardless of failure
    // category. The LLMService layer (multimodal mode + blocklist) auto-falls
    // back to text when the active model rejects images.
    await attachScreenshotIfAny(builtPrompt, details, reportId, `[llmQueue] Task ${task.id}`);

    await llmService.initialize();
    const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(
      builtPrompt,
      OUTPUT_RESERVE_TOKENS_BY_TASK.testAnalysis
    );

    const debugPrompt = renderSegmentsForDebug(segmentedPrompt);
    llmTasksDb.updatePrompt(task.id, debugPrompt);

    console.log(
      `[llmQueue] Task ${task.id}: segments=${segmentedPrompt.segments.length} chars=${debugPrompt.length} for test ${testId}${fitLog ? ` ${fitLog}` : ''}`
    );

    // Per-task temperature: prefer the user's task-specific override, fall back
    // to the base `llm.temperature`. The Settings UI exposes both. Cooler
    // values bias toward classification accuracy; warmer toward varied phrasing.
    // Pass the response schema so the provider returns typed JSON via tool use
    // (Anthropic) or response_format (OpenAI). LLMService respects the global
    // mode (auto/force/disabled) and handles unsupported-by-provider fallback.
    // User's per-task override wins; otherwise the per-task default constant.
    const testAnalysisTemp =
      llmCfg.testAnalysisTemperature ?? TASK_TEMPERATURE_DEFAULTS.testAnalysis;
    const response = await llmService.sendSegmentedMessage(segmentedPrompt, {
      temperature: testAnalysisTemp,
      responseSchema: TEST_FAILURE_ANALYSIS_SCHEMA,
    });

    // Extract analysis text + category. Prefer typed structured output when
    // present; fall back to fence-stripped JSON in response.content; finally
    // raw text. Each branch produces a single `analysisText` and optional
    // `llmCategory` so the empty-text guard below is uniform.
    let llmCategory: string | null = null;
    let analysisText = '';
    let extractionMode: 'structured' | 'json' | 'text' = 'text';

    if (response.structuredOutput && typeof response.structuredOutput === 'object') {
      const so = response.structuredOutput as { category?: string; analysis?: string };
      if (so.category) llmCategory = so.category;
      analysisText = typeof so.analysis === 'string' ? so.analysis.trim() : '';
      extractionMode = 'structured';
    } else {
      const trimmed = response.content.trim();
      // Unanchored: some local models emit a gibberish preamble before the
      // fenced JSON. Find the fence wherever it is and fall back to the
      // whole content if no fence is present.
      const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      const initialCandidate = (fenceMatch ? fenceMatch[1] : trimmed).trim();

      // Iteratively halve runs of 2+ consecutive backslashes before each
      // JSON.parse attempt. LM Studio/oMLX sometimes ignore json_schema
      // and emit multi-level-escaped JSON;
      // halving brings the payload back to standard JSON escape depth.
      let parsed: { category?: unknown; analysis?: unknown } | null = null;
      let cur = initialCandidate;
      for (let i = 0; i < 8; i++) {
        try {
          const p = JSON.parse(cur);
          if (p && typeof p === 'object') {
            parsed = p as { category?: unknown; analysis?: unknown };
            break;
          }
        } catch {
          // halve and retry
        }
        const halved = halveEscapedBackslashes(cur);
        if (halved === cur) break;
        cur = halved;
      }

      if (parsed) {
        if (typeof parsed.category === 'string') llmCategory = parsed.category;
        analysisText = typeof parsed.analysis === 'string' ? parsed.analysis.trim() : '';
        extractionMode = 'json';
      } else {
        analysisText = trimmed;
        extractionMode = 'text';
      }
    }

    // Some local models emit markdown with literal `\n` escapes instead of
    // actual newlines (JSON-string style without the envelope). Unwind so
    // headers and code fences render correctly downstream.
    analysisText = unescapeLiteralNewlines(analysisText).trim();

    // Empty analysis after extraction means the model spent tokens but didn't
    // produce usable text (common with structured-output mismatches or
    // thinking-only outputs). Fail the task instead of upserting an empty
    // row that the report viewer then treats as "still loading" forever.
    if (!analysisText) {
      console.warn(
        `[llmQueue] Task ${task.id}: empty analysis after extraction ` +
          `(mode=${extractionMode}, contentChars=${response.content.length}, ` +
          `category=${llmCategory ?? 'none'}, model=${response.model || 'unknown'}, ` +
          `outputTokens=${response.usage?.outputTokens ?? 'n/a'}). Raw head: ` +
          JSON.stringify(response.content.slice(0, 400))
      );
      llmTasksDb.fail(task.id, `LLM returned empty analysis (extraction=${extractionMode})`);
      return;
    }

    // LLM precedence rule: the LLM may override only when it returns a known category AND
    // either the heuristic was 'unknown' or the LLM's choice agrees with the heuristic.
    // Otherwise we trust the heuristic — preventing the "two classifiers disagree → label
    // flips between runs" problem. (heuristicCategory + isKnownCategory loaded above.)
    let category: string = heuristicCategory;
    let categorySource: 'heuristic' | 'llm' = 'heuristic';
    if (
      llmCategory &&
      isKnownCategory(llmCategory) &&
      (heuristicCategory === 'unknown' || llmCategory === heuristicCategory)
    ) {
      category = llmCategory;
      categorySource = 'llm';
    }

    const attempt = details.attempt ?? 1;
    const completionExtras = {
      usage: response.usage,
    };
    llmTasksDb.complete(task.id, analysisText, category, response.model, completionExtras);
    testAnalysisDb.upsert(
      testId,
      fileId,
      project,
      reportId,
      analysisText,
      category,
      response.model,
      attempt,
      undefined,
      completionExtras
    );

    if (failedRun?.runId) {
      testDb.updateFailureCategory(failedRun.runId, category, categorySource);
    }

    if (reportId && llmTasksDb.areAllTestTasksComplete(reportId)) {
      console.log(`[llmQueue] All test analyses for report ${reportId} complete`);
    }
  }

  /**
   * Extract failure details by parsing the report HTML from disk.
   * Used as fallback when failure_details is not stored on the test_run record (older reports)
   * AND as the "extract-on-read" enrichment path for rows that were persisted before the
   * evidence schema landed.
   *
   * Delegates the actual error/console/network/action extraction to
   * `failure-extraction.ts` so this module and `testManagement.ts` see
   * identical evidence regardless of which code path produced it.
   */
  public async extractDetailsFromReport(
    reportId: string,
    testId: string
  ): Promise<FailureDetailsForPrompt | null> {
    try {
      const reportDir = path.join(REPORTS_FOLDER, reportId);
      const htmlPath = path.join(reportDir, 'index.html');
      const html = await fs.readFile(htmlPath, 'utf-8');
      const reportInfo = await parseHtmlReport(html);

      if (!reportInfo?.files) return null;

      for (const file of reportInfo.files) {
        if (!file.tests) continue;
        for (const test of file.tests) {
          if (test.testId !== testId) continue;

          // Aggregate every attachment across results + the test-level set so the
          // returned shape matches what processReportSummary expects (attachments
          // listed by name).
          const allAttachments: Array<{ name: string; path: string; contentType: string }> = [];
          const attempts: Array<{
            attempt: number;
            status: string;
            message?: string;
            durationMs?: number;
          }> = [];

          // First non-passing result is the canonical attempt for the prompt's
          // primary error block; the others contribute to the attempts timeline.
          let firstFailedResult:
            | {
                status?: string;
                message?: string;
                duration?: number;
                attachments?: Array<{ name: string; contentType: string; path: string }>;
              }
            | undefined;

          if (test.results) {
            for (let i = 0; i < test.results.length; i++) {
              const result = test.results[i] as {
                status?: string;
                message?: string;
                duration?: number;
                attachments?: Array<{ name: string; contentType: string; path: string }>;
              };

              const summary =
                result.status === 'passed'
                  ? undefined
                  : (result.message ?? '').replace(/\s+/g, ' ').trim().substring(0, 300) ||
                    undefined;
              // Merged-blob `report.json` often leaves `result.status` empty on
              // failed results — fall back to the test-level outcome so the
              // timeline doesn't render `(unknown)` for every attempt.
              const resolvedStatus = result.status || test.outcome || 'unknown';
              attempts.push({
                attempt: i + 1,
                status: resolvedStatus,
                message: summary,
                durationMs: typeof result.duration === 'number' ? result.duration : undefined,
              });

              if (result.status !== 'passed' && !firstFailedResult) {
                firstFailedResult = result;
              }

              if (result.attachments) {
                for (const att of result.attachments) {
                  allAttachments.push({
                    name: att.name,
                    path: att.path,
                    contentType: att.contentType,
                  });
                }
              }
            }
          }

          if (test.attachments) {
            for (const att of test.attachments) {
              allAttachments.push({
                name: att.name,
                path: att.path,
                contentType: att.contentType,
              });
            }
          }

          // Run the unified evidence extractor against the first failed
          // result. When no failed result exists (e.g. a `flaky` test that
          // eventually passed) fall back to a synthetic outcome shape so the
          // page-snapshot / log readers still get a chance to run.
          // `testId` is required for the embedded report-payload lookup —
          // without it the code-frame, step-tree, stdout/stderr, and git/CI
          // segments stay empty.
          const evidence = await extractFailureEvidence(
            reportId,
            { testId: test.testId, title: test.title, outcome: test.outcome },
            firstFailedResult ?? { status: test.outcome, attachments: allAttachments }
          );

          return {
            message: evidence.errorMessage,
            stackTrace: evidence.stackTrace,
            testTitle: test.title,
            filePath: file.fileName || file.fileId,
            location: test.location,
            attachments: allAttachments,
            attempt: 1,
            status: test.outcome || 'failed',
            attempts: attempts.length > 0 ? attempts : undefined,
            evidence,
          };
        }
      }

      return null;
    } catch (error) {
      console.error(`[llmQueue] Failed to extract details from report ${reportId}:`, error);
      return null;
    }
  }

  private async processReportSummary(task: LlmTaskRow): Promise<void> {
    const { reportId, project } = task;
    if (!reportId) {
      llmTasksDb.fail(task.id, 'Missing reportId');
      return;
    }

    // Wait for per-test analyses to complete; requeue (bounded) if they're still in flight.
    if (!llmTasksDb.areAllTestTasksComplete(reportId)) {
      if (task.retryCount >= 20) {
        llmTasksDb.fail(task.id, 'Timed out waiting for test analyses to complete');
        return;
      }
      llmTasksDb.requeueWithRetryIncrement(task.id);
      console.log(
        `[llmQueue] Report summary ${task.id} requeued (${task.retryCount + 1}/20) — waiting for test analyses`
      );
      return;
    }

    const analysisByTest = collectPerTestAnalyses(reportId);
    const { hardFailingByKey, flakyByKey } = partitionFailingRunsByOutcome(reportId);

    // Fetch failure clusters scoped to this report. The full project history
    // gives the clustering strategies enough data to identify cross-run
    // patterns; scopeToReport then filters to clusters that contain at least
    // one test that failed in this specific report.
    const { getFailureClusters } = await import('../failure-clustering/index.js');
    const clusterReport = await getFailureClusters({
      project: project ?? undefined,
      reportId,
    });

    const trendContext = await buildTrendContextForReport(reportId);
    const { clusters, unclustered, flakyTests, categories } = shapeClustersForPrompt({
      clusterReport,
      hardFailingByKey,
      flakyByKey,
      analysisByTest,
      trendContext,
    });

    // Run context: git commit + CI links + Playwright env. The reports table
    // spreads `report.metadata` onto each row at read time, so these fields
    // are available directly on the report object (when the upload payload
    // included them).
    const { reportDb } = await import('./db/reports.sqlite.js');
    const currentReport = reportDb.getByID(reportId) as
      | (Record<string, unknown> & { createdAt?: string | Date })
      | undefined;
    const runContext = currentReport ? buildRunContextFromReport(currentReport) : undefined;

    const reportConfig = await service.getConfig();
    const reportLlmCfg = (reportConfig as any)?.llm ?? {};
    const builtPrompt = buildReportSummarySegments({
      reportId,
      categories,
      clusters,
      unclustered,
      flaky: flakyTests,
      runContext,
      trendContext,
      overrides: {
        systemPrompt: reportLlmCfg.customSystemPrompt,
        reportSummaryPrompt: reportLlmCfg.customReportSummaryPrompt,
        project: project ?? undefined,
      },
    });

    await llmService.initialize();
    const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(
      builtPrompt,
      OUTPUT_RESERVE_TOKENS_BY_TASK.reportSummary
    );

    const debugPrompt = renderSegmentsForDebug(segmentedPrompt);
    llmTasksDb.updatePrompt(task.id, debugPrompt);
    if (fitLog) console.log(`[llmQueue] Task ${task.id}: ${fitLog}`);

    const reportTemp =
      reportLlmCfg.reportSummaryTemperature ?? TASK_TEMPERATURE_DEFAULTS.reportSummary;
    const response = await llmService.sendSegmentedMessage(segmentedPrompt, {
      temperature: reportTemp,
      responseSchema: REPORT_ANALYSIS_SCHEMA,
    });

    // Prefer the provider's parsed structured output. Fall back to JSON or
    // markdown inside response.content for providers that don't honor the
    // schema (some local models). The fallback parser sets a sane verdict
    // based on keyword heuristics so the UI still renders the verdict badge.
    let structured =
      parseReportAnalysisStructured(response.structuredOutput) ??
      parseReportAnalysisFromText(response.content);

    if (structured) {
      // Inject the report's project into every codeRef so the UI can build
      // `?project=…` query params for test-detail links. A report has a
      // single project, so we know it server-side — saves having the model
      // emit it per ref.
      structured = {
        ...structured,
        reportId,
        sections: structured.sections.map((s) => ({
          ...s,
          codeRefs: s.codeRefs?.map((ref) => ({
            ...ref,
            project: ref.project ?? project ?? undefined,
          })),
        })),
      };
    }

    const summaryText = structured ? renderReportAnalysisAsMarkdown(structured) : response.content;

    llmTasksDb.complete(task.id, summaryText, null, response.model, {
      usage: response.usage,
    });

    const totalFailures = Object.values(categories).reduce((s, c) => s + c, 0);
    failureSummaryDb.upsertSummary(reportId, project || '', totalFailures, categories);
    failureSummaryDb.updateLlmSummary(reportId, summaryText, structured, response.model);
  }

  private async processProjectSummary(task: LlmTaskRow): Promise<void> {
    const { project, reportIds: reportIdsJson } = task;
    if (!project) {
      llmTasksDb.fail(task.id, 'Missing project');
      return;
    }

    const { reportDb } = await import('./db/reports.sqlite.js');

    // Use the route-supplied report IDs verbatim when present (the route stores
    // them already sorted newest-first and capped). Fall back to "latest 10 for
    // project" only for older queued tasks that pre-date the reportIds column.
    const explicitReportIds = (() => {
      if (!reportIdsJson) return null;
      try {
        const parsed = JSON.parse(reportIdsJson);
        return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')
          ? (parsed as string[])
          : null;
      } catch {
        return null;
      }
    })();

    let latestReports: ReturnType<typeof reportDb.getLatestByProject>;
    if (explicitReportIds && explicitReportIds.length > 0) {
      latestReports = explicitReportIds
        .map((rid) => reportDb.getByID(rid))
        .filter((r): r is NonNullable<typeof r> => !!r);
    } else {
      const projectArg = project === 'all' ? undefined : project;
      latestReports = reportDb.getLatestByProject(projectArg, PROJECT_SUMMARY_REPORT_LIMIT);
    }
    if (latestReports.length === 0) {
      llmTasksDb.fail(task.id, 'No reports found for project');
      return;
    }

    const failureSummaryMap = new Map(
      failureSummaryDb
        .getSummariesByProject(project, PROJECT_SUMMARY_REPORT_LIMIT)
        .map((s) => [s.reportId, s] as const)
    );

    // Aggregate failing test_runs into clusters via the shared
    // `getFailureClusters` engine (signature / stack-frame / fixture /
    // temporal strategies), then enrich each cluster with project-level
    // lifecycle data. Lets the model see "fixture beforeEach spans 5 tests"
    // as one entry rather than five separate signature root causes.
    const clusters = await aggregateProjectClusters(
      latestReports.map((r) => ({
        reportId: r.reportID,
        createdAt: String(r.createdAt),
        displayNumber: r.displayNumber,
      })),
      project,
      { topN: 10 }
    );

    // Fetch the prior window once and reuse for both the trend signal and
    // coverage shrinkage. Prior window = same length, immediately preceding
    // the oldest report in `latestReports`. Project='all' → cross-project.
    const oldestReportCreatedAt = latestReports.length
      ? String(latestReports[latestReports.length - 1].createdAt)
      : '';
    const latestReportCreatedAt = latestReports.length
      ? String(latestReports[0].createdAt)
      : '';
    const { reportDb: trendReportDb } = await import('./db/reports.sqlite.js');
    const priorReports = oldestReportCreatedAt
      ? trendReportDb.getLatestByProjectBefore(
          project === 'all' ? undefined : project,
          oldestReportCreatedAt,
          latestReports.length
        )
      : [];

    // Trend signal: pass rate / flaky / duration deltas vs the prior window.
    // Computed locally rather than via AnalyticsService because the inputs
    // are "the latest N reports" not a date window.
    const trendSignal = await computeProjectTrendSignal(
      latestReports,
      project,
      clusters,
      priorReports
    );

    // Coverage scope: suite size + quarantine churn + near-flakes + suite-
    // shrinkage signal. Lets the verdict frame failure counts relative to
    // the suite and surface signals that don't show up in the per-run
    // histograms (quarantine-still-failing, near-flakes).
    const coverage = computeProjectCoverageScope(
      latestReports.map((r) => r.reportID),
      priorReports.length > 0 ? priorReports.map((r) => r.reportID) : null,
      oldestReportCreatedAt,
      latestReportCreatedAt,
      project
    );

    const projectConfig = await service.getConfig();
    const projectLlmCfg = (projectConfig as any)?.llm ?? {};
    const builtPrompt = buildProjectSummarySegments({
      project,
      runs: latestReports.map((r) => {
        const summary = failureSummaryMap.get(r.reportID);
        return {
          reportId: r.reportID,
          displayNumber: r.displayNumber,
          createdAt: String(r.createdAt),
          stats: {
            total: r.stats?.total ?? 0,
            expected: r.stats?.expected ?? 0,
            unexpected: r.stats?.unexpected ?? 0,
            flaky: r.stats?.flaky ?? 0,
            skipped: r.stats?.skipped ?? 0,
          },
          totalFailures: summary?.totalFailures ?? 0,
          categories: summary?.categories ?? {},
          llmSummary: summary?.llmSummary ?? undefined,
          runContext: buildRunContextFromReport(r as unknown as Record<string, unknown>),
        };
      }),
      clusters,
      trendSignal,
      coverage,
      overrides: {
        systemPrompt: projectLlmCfg.customSystemPrompt,
        projectSummarySystemPrompt: projectLlmCfg.customProjectSummarySystemPrompt,
        projectSummaryInstructions: projectLlmCfg.customProjectSummaryInstructions,
      },
    });

    await llmService.initialize();
    const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(
      builtPrompt,
      OUTPUT_RESERVE_TOKENS_BY_TASK.projectSummary
    );

    const debugPrompt = renderSegmentsForDebug(segmentedPrompt);
    llmTasksDb.updatePrompt(task.id, debugPrompt);
    if (fitLog) console.log(`[llmQueue] Task ${task.id}: ${fitLog}`);

    const projectTemp =
      projectLlmCfg.projectSummaryTemperature ?? TASK_TEMPERATURE_DEFAULTS.projectSummary;
    const response = await llmService.sendSegmentedMessage(segmentedPrompt, {
      temperature: projectTemp,
      responseSchema: PROJECT_ANALYSIS_SCHEMA,
    });

    // Prefer the provider's parsed structured output. Fall back to JSON inside
    // response.content if a provider returned only text (some local models do).
    let structured =
      parseProjectAnalysisStructured(response.structuredOutput) ??
      parseProjectAnalysisFromText(response.content);

    if (structured) {
      // Drop refs pointing at testIds / reportIds the model fabricated — those
      // would render as 404 links. Valid IDs are the report IDs in the window
      // and the testIds the aggregator surfaced as affected by some root cause.
      const validReportIds = new Set(latestReports.map((r) => r.reportID));
      const validTestIds = new Set<string>();
      for (const c of clusters) {
        for (const t of c.affectedTests) validTestIds.add(t.testId);
      }
      structured = pruneInvalidCodeRefs(structured, validTestIds, validReportIds);

      // Inject `project` into test-kind code refs so the test detail page's
      // `?project=…` lookup is scoped correctly (testId+fileId aren't unique
      // across projects). The 'all' aggregate has no canonical project, so
      // skip injection in that case — the frontend then renders the ref
      // without a query, accepting a non-scoped lookup.
      if (project !== 'all') {
        structured = {
          ...structured,
          sections: structured.sections.map((section) =>
            section.codeRefs
              ? {
                  ...section,
                  codeRefs: section.codeRefs.map((ref) =>
                    ref.kind === 'test' ? { ...ref, project } : ref
                  ),
                }
              : section
          ),
        };
      }

      // Attach the latest reportId to the structured payload so the UI can map
      // unqualified codeRefs to a concrete report link.
      structured = { ...structured, latestReportId: latestReports[0]?.reportID };
    }

    // The legacy `summary` column still feeds older clients and the report-
    // viewer LLM injection. Always populate it; rebuild from structured when we
    // have it so the markdown stays in sync with the JSON.
    const summaryText = structured ? renderProjectAnalysisAsMarkdown(structured) : response.content;
    const structuredJson = structured ? JSON.stringify(structured) : null;

    llmTasksDb.complete(task.id, summaryText, null, response.model, {
      usage: response.usage,
    });

    // Mirror to the persisted dashboard cache so the UI reflects the new summary
    // on its next poll without re-running the LLM.
    const reportTimes = latestReports
      .map((r) => (r.createdAt ? new Date(String(r.createdAt)).getTime() : Number.NaN))
      .filter((t) => Number.isFinite(t)) as number[];
    projectSummaryDb.upsert({
      project,
      summary: summaryText,
      structured: structuredJson,
      model: response.model,
      lastReportId: latestReports[0]?.reportID,
      reportCount: latestReports.length,
      firstReportAt: reportTimes.length
        ? new Date(Math.min(...reportTimes)).toISOString()
        : undefined,
      lastReportAt: reportTimes.length
        ? new Date(Math.max(...reportTimes)).toISOString()
        : undefined,
    });
  }
}

export const llmAnalysisQueue = LlmAnalysisQueue.getInstance();

export interface TestAnalysisRequest {
  segmentedPrompt: SegmentedPrompt;
  debugPrompt: string;
  heuristicCategory: string;
  details: FailureDetailsForPrompt;
  failedRun: ReturnType<typeof testDb.getTestRuns>[number] | undefined;
  fitLog: string | null;
}

/**
 * Build the same prompt the queue would build for a test analysis. Used by
 * the streaming analyze-failed-test route so the "Ask LLM" button respects
 * the configured custom prompts, attaches screenshots when available, and
 * gets the full cache_control / fit-to-budget treatment.
 */
export async function buildTestAnalysisRequest(opts: {
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
}): Promise<TestAnalysisRequest | { error: string }> {
  const { testId, fileId, project, reportId } = opts;

  const runs = testDb.getTestRuns(testId, fileId, project);
  const failedRun =
    runs.find((r) => r.failureDetails && r.reportId === reportId) ||
    runs.find((r) => r.failureDetails) ||
    runs.find((r) => r.reportId === reportId) ||
    runs[0];

  let details: FailureDetailsForPrompt | null = null;
  if (failedRun?.failureDetails) {
    try {
      details = JSON.parse(failedRun.failureDetails);
    } catch {
      details = null;
    }
    // Re-extract from the report when stored details are missing/stale.
    // Stale = empty message, all-unknown attempts, or evidence missing every
    // payload-derived field. See isEvidenceStale / areAttemptsStale.
    if (
      details &&
      (!details.message || areAttemptsStale(details.attempts) || isEvidenceStale(details.evidence))
    ) {
      const extracted = await llmAnalysisQueue.extractDetailsFromReport(reportId, testId);
      if (extracted?.message && (!details.message || details.message.trim() === '')) {
        details.message = extracted.message;
        details.stackTrace ??= extracted.stackTrace;
      }
      if (extracted?.attempts && areAttemptsStale(details.attempts)) {
        details.attempts = extracted.attempts;
      }
      if (extracted?.evidence && isEvidenceStale(details.evidence)) {
        details.evidence = extracted.evidence;
      }
    }
  }
  if (!details) {
    details = await llmAnalysisQueue.extractDetailsFromReport(reportId, testId);
  }
  if (!details) {
    return { error: `No failure details for test ${testId} in report ${reportId}` };
  }

  if (details.message) details.message = stripAnsi(details.message);
  if (details.stackTrace) details.stackTrace = stripAnsi(details.stackTrace);

  const totalRuns = testDb.getTestRunCount(testId, fileId, project);
  const recentFailures = runs.filter(
    (r) => r.outcome === 'unexpected' || r.outcome === 'failed'
  ).length;

  const previousAnalysis = testAnalysisDb.getByTest(testId, fileId, project);
  const isNewFailure = !previousAnalysis;
  const feedback = analysisFeedbackDb.getByTest(testId, fileId, project);

  const config = await service.getConfig();
  const warningThreshold =
    (config as any)?.testManagement?.warningThresholdPercentage ??
    FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
  const flakinessScore = failedRun?.flakinessScore ?? 0;
  const llmCfg = (config as any)?.llm ?? {};
  const { detectFailureCategory } = await import('./testManagement.js');
  const heuristicCategory = detectFailureCategory(details.message);

  const promptOverrides = {
    systemPrompt: llmCfg.customSystemPrompt as string | undefined,
    testAnalysisSystemPrompt: llmCfg.customTestAnalysisSystemPrompt as string | undefined,
    projectSummarySystemPrompt: llmCfg.customProjectSummarySystemPrompt as string | undefined,
    testAnalysisInstructions: llmCfg.customTestAnalysisInstructions as string | undefined,
    reportSummaryPrompt: llmCfg.customReportSummaryPrompt as string | undefined,
    projectSummaryInstructions: llmCfg.customProjectSummaryInstructions as string | undefined,
    project,
    errorCategory: heuristicCategory,
  };

  const { entries: crossProjectEntries, totalCount: crossProjectTotalCount } =
    buildCrossProjectEntries(testId, fileId, project, failedRun?.errorSignature ?? undefined);

  const { recentOutcomes, previousCategoriesChronological } = buildRecentHistoryFromRuns(runs);

  await enrichEnvironmentFromReport(details, reportId);

  const priorPrior = testAnalysisDb.getLatestPriorByTest(testId, fileId, project, reportId);
  const builtPrompt = buildTestFailureSegments({
    failureDetails: details,
    historicalContext: {
      totalRuns,
      recentFailureCount: recentFailures,
      flakinessScore,
      flakinessThreshold: warningThreshold,
      isFlaky: flakinessScore >= warningThreshold,
      isNewFailure,
      recentOutcomes,
      previousCategories: previousCategoriesChronological,
    },
    feedback,
    crossProjectEntries,
    crossProjectTotalCount,
    priorInProjectAnalysis: priorPrior?.analysis
      ? {
          analysis: priorPrior.analysis,
          category: priorPrior.category ?? undefined,
          model: priorPrior.model ?? undefined,
          updatedAt: priorPrior.updatedAt ?? priorPrior.createdAt,
        }
      : null,
    overrides: promptOverrides,
  });

  await attachScreenshotIfAny(builtPrompt, details, reportId);

  await llmService.initialize();
  const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(
    builtPrompt,
    OUTPUT_RESERVE_TOKENS_BY_TASK.testAnalysis
  );
  const debugPrompt = renderSegmentsForDebug(segmentedPrompt);

  return {
    segmentedPrompt,
    debugPrompt,
    heuristicCategory,
    details,
    failedRun,
    fitLog,
  };
}

const MAX_TREND_LIST_ITEMS = 25;

/** Run identifier + timestamp pair used for first/last-seen tracking.
 *  Callers MUST pass entries newest-first — index 0 is the most recent run. */
interface AggregateRun {
  reportId: string;
  createdAt: string;
  /** Optional display number for readable run labels in the prompt. */
  displayNumber?: number;
}

/** Derive a stable cross-window identity for a cluster from its strategy +
 *  primary evidence. UUIDs aren't stable across `getFailureClusters` calls,
 *  so the project-summary uses this key to detect which clusters are the
 *  "same" cluster between windows. Temporal clusters get a member-test
 *  fingerprint since they lack stable evidence. */
function buildClusterStableKey(
  strategy: ClusterStrategy,
  evidence: { signature?: string; stackFrame?: string; fixturePhase?: string },
  memberKeys: string[]
): string {
  if (evidence.signature) return `signature:${evidence.signature}`;
  if (strategy === 'stack-frame' && evidence.stackFrame) return `stack-frame:${evidence.stackFrame}`;
  if (strategy === 'fixture' && evidence.fixturePhase) {
    return `fixture:${evidence.fixturePhase}:${evidence.stackFrame ?? evidence.signature ?? ''}`;
  }
  // Temporal (or any cluster missing primary evidence): identity is the sorted
  // set of member testIds. Cheap fingerprint, stable for the same membership.
  return `${strategy}:${[...memberKeys].sort().join(',')}`;
}

/**
 * Group failing test_runs into project-level clusters via the shared
 * `getFailureClusters` engine, then enrich each cluster with project-level
 * lifecycle data (first/last seen in window, retry recovery, latest LLM
 * root-cause for a representative test).
 *
 * `getFailureClusters` runs strategies (signature, stack-frame, fixture,
 * temporal) and merges overlapping clusters — so a fixture failure spanning
 * 5 unrelated tests collapses into one entry tagged `strategy: fixture`,
 * different from 5 separate signature-based root causes.
 *
 * Reports are passed newest-first.
 */
async function aggregateProjectClusters(
  reports: AggregateRun[],
  project: string,
  options: { topN: number }
): Promise<ProjectCluster[]> {
  if (reports.length === 0) return [];

  const oldest = reports[reports.length - 1];
  const latest = reports[0];
  const projectArg = project === 'all' ? undefined : project;

  const { getFailureClusters } = await import('../failure-clustering/index.js');
  // minTests=1 catches single-test repeat failures (which the old signature
  // aggregator handled natively); strategies emit single-test clusters at
  // that threshold and merge with multi-test clusters where appropriate.
  const clusterReport = await getFailureClusters({
    project: projectArg,
    from: oldest.createdAt,
    to: latest.createdAt,
    minTests: 1,
  });

  if (clusterReport.clusters.length === 0) return [];

  // Index testKey → cluster.id so the per-run walk can attribute each failing
  // test_run to its cluster.
  const testKeyToClusterIds = new Map<string, string[]>();
  for (const c of clusterReport.clusters) {
    for (const t of c.tests) {
      const key = `${t.testId}::${t.fileId}::${t.project}`;
      const list = testKeyToClusterIds.get(key) ?? [];
      list.push(c.id);
      testKeyToClusterIds.set(key, list);
    }
  }

  // Per-cluster lifecycle accumulator.
  interface ClusterAgg {
    reportIndices: Set<number>;
    occurrences: number;
    flakyOccurrences: number;
    /** failure_category counts — most common is reported as the cluster's
     *  category when the engine's own `category` field is empty. */
    categories: Map<string, number>;
  }
  const aggByClusterId = new Map<string, ClusterAgg>();
  for (const c of clusterReport.clusters) {
    aggByClusterId.set(c.id, {
      reportIndices: new Set(),
      occurrences: 0,
      flakyOccurrences: 0,
      categories: new Map(),
    });
  }

  for (let i = 0; i < reports.length; i++) {
    const runs = testDb.getTestRunsByReport(reports[i].reportId);
    for (const run of runs) {
      if (run.outcome === 'expected' || run.outcome === 'skipped' || run.outcome === 'passed') {
        continue;
      }
      const key = `${run.testId}::${run.fileId}::${run.project}`;
      const clusterIds = testKeyToClusterIds.get(key);
      if (!clusterIds) continue;
      for (const cid of clusterIds) {
        const agg = aggByClusterId.get(cid);
        if (!agg) continue;
        agg.reportIndices.add(i);
        agg.occurrences++;
        if (run.outcome === 'flaky') agg.flakyOccurrences++;
        const cat = run.failureCategory ?? 'unknown';
        agg.categories.set(cat, (agg.categories.get(cat) ?? 0) + 1);
      }
    }
  }

  const projectClusters: ProjectCluster[] = [];
  for (const c of clusterReport.clusters) {
    const agg = aggByClusterId.get(c.id);
    if (!agg || agg.reportIndices.size === 0) continue;

    const newestIdx = Math.min(...agg.reportIndices);
    const oldestIdx = Math.max(...agg.reportIndices);
    const firstSeen = reports[oldestIdx];
    const lastSeen = reports[newestIdx];
    let consecutive = 0;
    while (agg.reportIndices.has(consecutive)) consecutive++;
    const retryRecoveryRate =
      agg.occurrences > 0 ? agg.flakyOccurrences / agg.occurrences : 0;

    // Engine-provided category wins; fall back to most-common per-run category.
    let category = c.category ?? '';
    if (!category) {
      const sorted = [...agg.categories.entries()].sort((a, b) => b[1] - a[1]);
      category = sorted[0]?.[0] ?? 'unknown';
    }

    const memberKeys = c.tests.map((t) => `${t.testId}::${t.fileId}::${t.project}`);
    const stableKey = buildClusterStableKey(c.strategy, c.evidence, memberKeys);

    projectClusters.push({
      stableKey,
      strategy: c.strategy,
      evidence: c.evidence,
      category,
      occurrences: agg.occurrences,
      reportsAffected: agg.reportIndices.size,
      affectedTests: c.tests.map((t) => ({
        testId: t.testId,
        fileId: t.fileId,
        title: t.title,
        filePath: t.filePath ?? t.fileId,
      })),
      sampleMessage: c.sampleMessage,
      firstSeenReportId: firstSeen.reportId,
      firstSeenAt: firstSeen.createdAt,
      firstSeenDisplayNumber: firstSeen.displayNumber,
      lastSeenReportId: lastSeen.reportId,
      lastSeenAt: lastSeen.createdAt,
      lastSeenDisplayNumber: lastSeen.displayNumber,
      appearedInLatestRun: newestIdx === 0,
      consecutiveLatestRuns: consecutive,
      runsSinceLastSeen: newestIdx,
      flakyOccurrences: agg.flakyOccurrences,
      retryRecoveryRate,
    });
  }

  // Sort by impact (occurrences desc, then reportsAffected desc, then stableKey
  // as a deterministic tiebreaker for cache prefix stability).
  projectClusters.sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    if (b.reportsAffected !== a.reportsAffected) return b.reportsAffected - a.reportsAffected;
    return a.stableKey.localeCompare(b.stableKey);
  });

  const top = projectClusters.slice(0, options.topN);

  // Enrich top entries with the most recent per-test LLM root-cause paragraph.
  for (const cluster of top) {
    const repTest = cluster.affectedTests[0];
    if (!repTest) continue;
    for (const r of reports) {
      const analysis = testAnalysisDb.getByTestAndReport(repTest.testId, r.reportId);
      if (analysis?.analysis) {
        cluster.latestRootCause = extractRootCauseParagraph(analysis.analysis);
        break;
      }
    }
  }

  return top;
}

/** Structural shape used by the trend-signal helpers — kept narrow so any
 *  ReportHistory-like row from the DB satisfies it without coupling this file
 *  to the full ReportHistory type. */
interface TrendReportLike {
  stats?: { expected?: number; unexpected?: number; flaky?: number };
  duration?: number;
  displayNumber?: number;
}

/** Collapse a list of reports into the window-aggregate used by the trend
 *  signal. Pass rate counts only executed tests (skipped excluded). Duration
 *  averages over reports that carry a value — reports without `duration`
 *  aren't counted in the denominator. A run counts as "passing" when it has
 *  zero unexpected AND zero flaky tests — matches the runHasFailures check
 *  used elsewhere in the project-summary prompt. */
function summarizeReportsForTrend(reports: TrendReportLike[]): ProjectTrendWindow {
  let expected = 0;
  let unexpected = 0;
  let flaky = 0;
  let durationSum = 0;
  let durationDenom = 0;
  let passingRuns = 0;
  for (const r of reports) {
    const e = r.stats?.expected ?? 0;
    const u = r.stats?.unexpected ?? 0;
    const f = r.stats?.flaky ?? 0;
    expected += e;
    unexpected += u;
    flaky += f;
    if (u === 0 && f === 0) passingRuns++;
    if (typeof r.duration === 'number' && r.duration > 0) {
      durationSum += r.duration;
      durationDenom++;
    }
  }
  const executed = expected + unexpected + flaky;
  const passRatePct = executed > 0 ? (expected / executed) * 100 : 0;
  return {
    runs: reports.length,
    passingRuns,
    passRatePct,
    flakyCount: flaky,
    failureCount: unexpected + flaky,
    avgRunDurationMs: durationDenom > 0 ? durationSum / durationDenom : 0,
  };
}

/** Build the trend signal block input for the project-summary prompt:
 *  current-window aggregates, prior-window aggregates (when supplied), the
 *  in-window last-half-vs-first-half failure split (when the window has ≥4
 *  runs), and the cross-window cluster flow (resolved / persisting / new). */
async function computeProjectTrendSignal(
  currentWindow: Array<TrendReportLike & { reportID: string; createdAt: string | Date }>,
  project: string,
  currentClusters: ProjectCluster[],
  priorReports: Array<TrendReportLike & { reportID: string; createdAt: string | Date }>
): Promise<ProjectTrendSignal | undefined> {
  if (currentWindow.length === 0) return undefined;
  const current = summarizeReportsForTrend(currentWindow);

  const prior = priorReports.length > 0 ? summarizeReportsForTrend(priorReports) : undefined;

  // In-window split: most recent half vs older half. Surface only when each
  // half has ≥2 runs so the split is statistically meaningful.
  let splits: ProjectTrendSignal['splits'];
  if (currentWindow.length >= 4) {
    const halfSize = Math.floor(currentWindow.length / 2);
    const lastHalf = currentWindow.slice(0, halfSize);
    const firstHalf = currentWindow.slice(currentWindow.length - halfSize);
    const lastSum = summarizeReportsForTrend(lastHalf);
    const firstSum = summarizeReportsForTrend(firstHalf);
    splits = {
      halfSize,
      lastHalfFailures: lastSum.failureCount,
      firstHalfFailures: firstSum.failureCount,
    };
  }

  // Cluster flow: re-run the cluster aggregator over the prior window and
  // compare stableKey membership with the current window's clusters. Resolved
  // clusters (present in prior, absent in current) are the strongest recovery
  // evidence; new clusters (present in current, absent in prior) are the
  // strongest regression evidence.
  let clusterFlow: ProjectTrendSignal['clusterFlow'];
  if (priorReports.length > 0) {
    const priorClusters = await aggregateProjectClusters(
      priorReports.map((r) => ({
        reportId: r.reportID,
        createdAt: String(r.createdAt),
        displayNumber: r.displayNumber,
      })),
      project,
      { topN: 50 }
    );
    const currentKeys = new Set(currentClusters.map((c) => c.stableKey));
    const priorKeys = new Set(priorClusters.map((c) => c.stableKey));
    const resolved = priorClusters.filter((c) => !currentKeys.has(c.stableKey));
    const persisting = priorClusters.filter((c) => currentKeys.has(c.stableKey));
    const newCount = currentClusters.filter((c) => !priorKeys.has(c.stableKey)).length;
    resolved.sort((a, b) => {
      if (b.reportsAffected !== a.reportsAffected) return b.reportsAffected - a.reportsAffected;
      return b.occurrences - a.occurrences;
    });
    clusterFlow = {
      resolvedCount: resolved.length,
      persistingCount: persisting.length,
      newCount,
      topResolved: resolved.slice(0, 3).map((c) => ({
        strategy: c.strategy,
        category: c.category,
        reportsAffected: c.reportsAffected,
        sampleTest: c.affectedTests[0]?.title,
      })),
    };
  }

  return { current, prior, splits, clusterFlow };
}

/** Compute the suite/quarantine/near-flake summary for the project-summary
 *  prompt. Inline SQL via getDatabase() — none of these are reused elsewhere.
 *  Project='all' → no project filter. `priorReportIds` is optional; when
 *  supplied, the helper also returns `priorDistinctTests` so the model can
 *  reason about suite shrinkage. */
function computeProjectCoverageScope(
  reportIds: string[],
  priorReportIds: string[] | null,
  windowStartIso: string,
  windowEndIso: string,
  project: string
): ProjectCoverageScope | undefined {
  if (reportIds.length === 0) return undefined;
  const db = getDatabase();
  const projectFilter = project === 'all' ? '' : ' AND project = ?';
  const projectParams = project === 'all' ? [] : [project];

  const totalTests = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM tests WHERE 1=1${projectFilter}`)
      .get(...projectParams) as { c: number }
  ).c;

  const testsAddedInWindow = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM tests WHERE createdAt >= ? AND createdAt <= ?${projectFilter}`
      )
      .get(windowStartIso, windowEndIso, ...projectParams) as { c: number }
  ).c;

  // Quarantined = the most recent test_run per (testId, fileId, project) has
  // quarantined=1. Subquery picks the latest createdAt for each test; the
  // outer count keeps rows whose latest run is quarantined.
  const currentlyQuarantined = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT testId, fileId, project, MAX(createdAt) AS latest_at
           FROM test_runs
           WHERE 1=1${projectFilter}
           GROUP BY testId, fileId, project
         ) latest
         JOIN test_runs tr
           ON tr.testId = latest.testId
           AND tr.fileId = latest.fileId
           AND tr.project = latest.project
           AND tr.createdAt = latest.latest_at
         WHERE tr.quarantined = 1`
      )
      .get(...projectParams) as { c: number }
  ).c;

  const reportIdsPlaceholders = reportIds.map(() => '?').join(',');
  const quarantineFailuresInWindow = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM test_runs
         WHERE quarantined = 1
           AND outcome IN ('unexpected', 'flaky', 'failed')
           AND reportId IN (${reportIdsPlaceholders})`
      )
      .get(...reportIds) as { c: number }
  ).c;

  // Distinct tests with at least one run in the current window.
  const windowDistinctTests = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT testId || '::' || fileId || '::' || project) AS c
         FROM test_runs WHERE reportId IN (${reportIdsPlaceholders})`
      )
      .get(...reportIds) as { c: number }
  ).c;

  let priorDistinctTests: number | undefined;
  if (priorReportIds && priorReportIds.length > 0) {
    const priorPlaceholders = priorReportIds.map(() => '?').join(',');
    priorDistinctTests = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT testId || '::' || fileId || '::' || project) AS c
           FROM test_runs WHERE reportId IN (${priorPlaceholders})`
        )
        .get(...priorReportIds) as { c: number }
    ).c;
  }

  // Near-flakes: tests with `flaky` outcome (passed on retry) in window
  // reports. Group by (testId, fileId) and join `tests` for the title +
  // filePath. Top 5 by occurrence count.
  type NearFlakeRow = {
    testId: string;
    fileId: string;
    title: string | null;
    filePath: string | null;
    c: number;
  };
  const nearFlakeRows = db
    .prepare(
      `SELECT tr.testId AS testId, tr.fileId AS fileId,
              t.title AS title, t.filePath AS filePath,
              COUNT(*) AS c
       FROM test_runs tr
       LEFT JOIN tests t
         ON t.testId = tr.testId AND t.fileId = tr.fileId AND t.project = tr.project
       WHERE tr.outcome = 'flaky'
         AND tr.reportId IN (${reportIdsPlaceholders})
       GROUP BY tr.testId, tr.fileId, tr.project
       ORDER BY c DESC, tr.testId
       LIMIT 5`
    )
    .all(...reportIds) as NearFlakeRow[];
  const nearFlakes = nearFlakeRows.map((row) => ({
    testId: row.testId,
    fileId: row.fileId,
    title: row.title ?? row.testId,
    filePath: row.filePath ?? row.fileId,
    flakyOccurrences: row.c,
  }));

  return {
    totalTests,
    testsAddedInWindow,
    currentlyQuarantined,
    quarantineFailuresInWindow,
    windowDistinctTests,
    priorDistinctTests,
    nearFlakes,
  };
}

type ReportFailureRecord = {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  category: string;
  errorSignature?: string;
  message: string;
};

type FailingByKey = Map<string, ReportFailureRecord>;

type AnalysisByKey = Map<string, { category: string; analysis: string }>;

/** Load per-test analyses for a report and index them by
 *  `testId::fileId::project` so they can be attached to cluster members. */
function collectPerTestAnalyses(reportId: string): AnalysisByKey {
  const rows = testAnalysisDb.getByReport(reportId);
  const out: AnalysisByKey = new Map();
  for (const ta of rows) {
    const key = `${ta.testId}::${ta.fileId}::${ta.project}`;
    out.set(key, {
      category: ta.category || 'unknown',
      analysis: ta.analysis || '',
    });
  }
  return out;
}

/** Split this report's failing runs into hard failures (`unexpected` /
 *  `failed`) vs. flakes (`flaky` — failed at least once but passed on retry).
 *  Verdict-driving inputs use the hard-failing map; flakes are surfaced as
 *  observations. First row per (testId, fileId, project) key wins — report
 *  payloads typically have one row per test. */
function partitionFailingRunsByOutcome(
  reportId: string
): { hardFailingByKey: FailingByKey; flakyByKey: FailingByKey } {
  const reportRuns = testDb.getTestRunsByReport(reportId);
  const hardFailingByKey: FailingByKey = new Map();
  const flakyByKey: FailingByKey = new Map();
  for (const run of reportRuns) {
    const isHardFail = run.outcome === 'unexpected' || run.outcome === 'failed';
    const isFlaky = run.outcome === 'flaky';
    if (!isHardFail && !isFlaky) continue;
    let message = '';
    if (run.failureDetails) {
      try {
        const parsed = JSON.parse(run.failureDetails);
        message = String(parsed?.message ?? '');
      } catch {
        // ignore — empty message
      }
    }
    const test = testDb.getTest(run.testId, run.fileId, run.project);
    const key = `${run.testId}::${run.fileId}::${run.project}`;
    const rec: ReportFailureRecord = {
      testId: run.testId,
      fileId: run.fileId,
      project: run.project,
      title: test?.title ?? run.testId,
      filePath: test?.filePath,
      category: run.failureCategory ?? 'unknown',
      errorSignature: run.errorSignature ?? undefined,
      message,
    };
    const target = isHardFail ? hardFailingByKey : flakyByKey;
    if (!target.has(key)) target.set(key, rec);
  }
  return { hardFailingByKey, flakyByKey };
}

/** Shape the prompt-ready cluster / unclustered / flaky / categories inputs
 *  from raw cluster data + per-report failing maps + the prev-report trend.
 *  Each in-report cluster member and unclustered failure carries a `trend`
 *  tag (`newlyFailed` / `stillFailing` / `unknown`) computed from the trend
 *  context, keyed by (title, filePath). Historical cluster members (tests
 *  that belong to the cluster but didn't fail in this run) leave `trend`
 *  unset since the prev-report diff doesn't apply to them. */
function shapeClustersForPrompt(args: {
  clusterReport: Awaited<ReturnType<typeof import('../failure-clustering/index.js').getFailureClusters>>;
  hardFailingByKey: FailingByKey;
  flakyByKey: FailingByKey;
  analysisByTest: AnalysisByKey;
  trendContext: ReportSummaryTrendContext | undefined;
}) {
  const { clusterReport, hardFailingByKey, flakyByKey, analysisByTest, trendContext } = args;

  type Trend = 'newlyFailed' | 'stillFailing' | 'unknown';
  const trendByTitleFile = new Map<string, Trend>();
  if (trendContext) {
    const mkKey = (t: { title: string; filePath: string }) => `${t.title}::${t.filePath}`;
    for (const t of trendContext.newlyFailed) trendByTitleFile.set(mkKey(t), 'newlyFailed');
    for (const t of trendContext.stillFailing) trendByTitleFile.set(mkKey(t), 'stillFailing');
  }
  const trendFor = (title: string, filePath?: string): Trend =>
    trendContext ? (trendByTitleFile.get(`${title}::${filePath ?? ''}`) ?? 'unknown') : 'unknown';

  const clusters = clusterReport.clusters.map((c) => {
    const members = c.tests.map((t) => {
      const key = `${t.testId}::${t.fileId}::${t.project}`;
      const rec = hardFailingByKey.get(key);
      const a = analysisByTest.get(key);
      const inThisReport = !!rec;
      return {
        testId: t.testId,
        fileId: t.fileId,
        project: t.project,
        title: t.title,
        filePath: t.filePath,
        inThisReport,
        category: rec?.category ?? a?.category ?? c.category,
        message: rec?.message ?? '',
        analysis: a?.analysis ?? '',
        occurrences: t.occurrences,
        trend: inThisReport ? trendFor(t.title, t.filePath) : undefined,
      };
    });
    return {
      id: c.id,
      strategy: c.strategy,
      name: c.name,
      category: c.category,
      sampleMessage: c.sampleMessage,
      testCount: c.testCount,
      failureCount: c.failureCount,
      evidence: c.evidence,
      members,
    };
  });

  const clusteredKeys = new Set<string>();
  for (const c of clusterReport.clusters) {
    for (const t of c.tests) {
      clusteredKeys.add(`${t.testId}::${t.fileId}::${t.project}`);
    }
  }

  const unclustered: Array<ReportFailureRecord & { analysis: string; trend: Trend }> = [];
  for (const [key, rec] of hardFailingByKey) {
    if (clusteredKeys.has(key)) continue;
    const a = analysisByTest.get(key);
    unclustered.push({
      ...rec,
      analysis: a?.analysis ?? '',
      trend: trendFor(rec.title, rec.filePath),
    });
  }

  const flakyTests = Array.from(flakyByKey.values()).map((rec) => {
    const key = `${rec.testId}::${rec.fileId}::${rec.project}`;
    const a = analysisByTest.get(key);
    return { ...rec, analysis: a?.analysis ?? '' };
  });

  // Categories histogram, derived from hard failures only. Prefer the
  // LLM-corrected category from the per-test analysis when available; fall
  // back to the heuristic on the run row.
  const categories: Record<string, number> = {};
  for (const [key, rec] of hardFailingByKey) {
    const a = analysisByTest.get(key);
    const cat = a?.category || rec.category || 'unknown';
    categories[cat] = (categories[cat] ?? 0) + 1;
  }

  return { clusters, unclustered, flakyTests, categories };
}

/**
 * Lift the run-context fields (git commit, CI links, Playwright env, createdAt)
 * from a report row. The reports DB spreads `report.metadata` onto each row at
 * read time, so these fields are looked up directly by name. Returns
 * `undefined` when no recognized fields are present.
 */
function buildRunContextFromReport(
  report: Record<string, unknown> & { createdAt?: string | Date }
): import('../llm/prompts/index.js').ReportSummaryRunContext | undefined {
  const gitCommitRaw = report.gitCommit as
    | { hash?: string; shortHash?: string; branch?: string; subject?: string }
    | undefined;
  const ciRaw = report.ci as
    | { buildHref?: string; commitHref?: string; commitHash?: string }
    | undefined;
  const playwrightVersion =
    typeof report.playwrightVersion === 'string' ? report.playwrightVersion : undefined;
  const actualWorkers =
    typeof report.actualWorkers === 'number' ? report.actualWorkers : undefined;
  const createdAt =
    report.createdAt instanceof Date
      ? report.createdAt.toISOString()
      : typeof report.createdAt === 'string'
        ? report.createdAt
        : undefined;

  const gitCommit =
    gitCommitRaw &&
    (gitCommitRaw.hash || gitCommitRaw.shortHash || gitCommitRaw.branch || gitCommitRaw.subject)
      ? {
          hash: gitCommitRaw.hash,
          shortHash: gitCommitRaw.shortHash,
          branch: gitCommitRaw.branch,
          subject: gitCommitRaw.subject,
        }
      : undefined;
  const ci =
    ciRaw && (ciRaw.buildHref || ciRaw.commitHref || ciRaw.commitHash)
      ? { buildHref: ciRaw.buildHref, commitHref: ciRaw.commitHref, commitHash: ciRaw.commitHash }
      : undefined;

  if (!gitCommit && !ci && !playwrightVersion && actualWorkers === undefined && !createdAt) {
    return undefined;
  }
  return { gitCommit, ci, playwrightVersion, actualWorkers, createdAt };
}

/**
 * Build the trend context for a report-summary LLM prompt by diffing against
 * the most recent prior report in the same project. Returns `undefined` when
 * there is no prior report (first run for the project) or when the diff
 * computation fails — the prompt simply omits the trend segment in that case.
 */
async function buildTrendContextForReport(
  reportId: string
): Promise<ReportSummaryTrendContext | undefined> {
  const { reportDb } = await import('./db/reports.sqlite.js');
  const current = reportDb.getByID(reportId);
  if (!current) return undefined;

  const createdAtISO =
    current.createdAt instanceof Date
      ? current.createdAt.toISOString()
      : String(current.createdAt as unknown as string);

  const previous = findPreviousReportInProject(current.project, createdAtISO, reportId);
  if (!previous) return undefined;

  const { result, error } = compareReports(previous.reportID, reportId);
  if (error || !result) {
    console.warn(`[llmQueue] trend context skipped for ${reportId}: ${error ?? 'unknown'}`);
    return undefined;
  }

  const trimEntry = (e: { title: string; filePath: string }) => ({
    title: e.title,
    filePath: e.filePath,
  });

  return {
    previousReport: {
      reportId: result.reportA.reportID,
      title: result.reportA.title,
      displayNumber: result.reportA.displayNumber,
      createdAt: result.reportA.createdAt,
    },
    counts: {
      newlyFailed: result.summary.newlyFailedCount,
      fixed: result.summary.fixedCount,
      stillFailing: result.summary.stillFailingCount,
      newTests: result.summary.newTestsCount,
      removedTests: result.summary.removedTestsCount,
      durationRegressions: result.summary.durationRegressionsCount,
      durationImprovements: result.summary.durationImprovementsCount,
    },
    newlyFailed: result.newlyFailed.slice(0, MAX_TREND_LIST_ITEMS).map(trimEntry),
    fixed: result.fixed.slice(0, MAX_TREND_LIST_ITEMS).map(trimEntry),
    stillFailing: result.stillFailing.slice(0, MAX_TREND_LIST_ITEMS).map(trimEntry),
    topDurationRegressions: result.durationDeltas
      .filter((d) => d.deltaMs > 0)
      .slice(0, MAX_TREND_LIST_ITEMS)
      .map((d) => ({
        title: d.title,
        filePath: d.filePath,
        durationA: d.durationA,
        durationB: d.durationB,
        deltaMs: d.deltaMs,
        deltaPct: d.deltaPct,
      })),
  };
}
