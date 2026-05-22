import fs from 'node:fs/promises';
import path from 'node:path';
import { FLAKINESS_THRESHOLDS } from '@playwright-reports/shared';
import { llmService } from '../llm/index.js';
import {
  parseProjectAnalysisFromText,
  parseProjectAnalysisStructured,
  renderProjectAnalysisAsMarkdown,
} from '../llm/projectAnalysis.js';
import type {
  FailureDetailsForPrompt,
  ProjectRootCause,
  ReportSummaryTrendContext,
} from '../llm/prompts/index.js';
import {
  buildProjectSummarySegments,
  buildReportSummarySegments,
  buildTestFailureSegments,
  extractRootCauseParagraph,
  fitPromptToBudget,
  PROJECT_ANALYSIS_SCHEMA,
  renderSegmentsForDebug,
  TEST_FAILURE_ANALYSIS_SCHEMA,
  unescapeLiteralNewlines,
} from '../llm/prompts/index.js';
import type { SegmentedPrompt } from '../llm/types/index.js';
import { extractFailureEvidence, stripAnsi } from '../parser/failure-extraction.js';
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

/** Per-task output-token reserve used by fitToContextWindow. Each value
 *  reflects the rough cap on how much markdown each task type tends to
 *  produce: test-analysis is one diagnosis (~800–1500 tokens out, 4000 is
 *  generous); report-summary is three sections of markdown across a run;
 *  project-summary is verdict + ≤4 sections across the latest 10 runs and
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

      // Stored details often have an empty message in merged reports — enrich from
      // attachments (error-context, trace) which carry the real error text. Also
      // enrich the attempt timeline for reports written before that field existed.
      // Extract-on-read fallback for the structured evidence: rows persisted before
      // the evidence schema landed have no `evidence` field; we re-extract here so
      // the LLM prompt sees the same evidence as fresh uploads.
      const needsMessageEnrich = !details.message || details.message.trim() === '';
      const needsAttemptsEnrich = !details.attempts || details.attempts.length === 0;
      const needsEvidenceEnrich = !details.evidence;
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
      reportSummarySystemPrompt: llmCfg.customReportSummarySystemPrompt as string | undefined,
      projectSummarySystemPrompt: llmCfg.customProjectSummarySystemPrompt as string | undefined,
      testAnalysisInstructions: llmCfg.customTestAnalysisInstructions as string | undefined,
      reportSummaryInstructions: llmCfg.customReportSummaryInstructions as string | undefined,
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
      const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
      const jsonStr = fenceMatch ? fenceMatch[1].trim() : trimmed;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed?.category && typeof parsed.category === 'string') {
          llmCategory = parsed.category;
        }
        analysisText = typeof parsed?.analysis === 'string' ? parsed.analysis.trim() : '';
        extractionMode = 'json';
      } catch {
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
              attempts.push({
                attempt: i + 1,
                status: result.status ?? 'unknown',
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
          const evidence = await extractFailureEvidence(
            reportId,
            { title: test.title, outcome: test.outcome },
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
            status: test.outcome,
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

    const testAnalyses = testAnalysisDb.getByReport(reportId);
    const categories: Record<string, number> = {};
    const perTestAnalyses: Array<{ testTitle: string; category: string; analysis: string }> = [];

    for (const ta of testAnalyses) {
      if (ta.category) {
        categories[ta.category] = (categories[ta.category] || 0) + 1;
      }
      const test = testDb.getTest(ta.testId, ta.fileId, ta.project);
      perTestAnalyses.push({
        testTitle: test?.title || ta.testId,
        category: ta.category || 'unknown',
        analysis: ta.analysis || '',
      });
    }

    const errorGroups: Array<{
      signature: string;
      category: string;
      count: number;
      sampleMessage: string;
      affectedTests: string[];
    }> = [];
    const signatureMap = new Map<
      string,
      { category: string; count: number; message: string; tests: Set<string> }
    >();

    const reportRuns = testDb.getTestRunsByReport(reportId);
    for (const run of reportRuns) {
      if (!run.errorSignature || !run.failureDetails) continue;
      let details: any;
      try {
        details = JSON.parse(run.failureDetails);
      } catch {
        continue;
      }

      const existing = signatureMap.get(run.errorSignature);
      if (existing) {
        existing.count++;
        existing.tests.add(run.testId);
      } else {
        signatureMap.set(run.errorSignature, {
          category: run.failureCategory || 'unknown',
          count: 1,
          message: details.message || '',
          tests: new Set([run.testId]),
        });
      }
    }

    for (const [sig, data] of signatureMap) {
      errorGroups.push({
        signature: sig,
        category: data.category,
        count: data.count,
        sampleMessage: data.message,
        affectedTests: Array.from(data.tests),
      });
    }
    errorGroups.sort((a, b) => b.count - a.count);

    // Inject per-test feedback notes for tests in this report (capped at 10 by recency).
    // The report summary is itself an aggregation of test analyses, so test-level feedback
    // is what's relevant here; there is no separate report-level feedback.
    const perTestFeedback = analysisFeedbackDb.getPerTestForReport(reportId, 10);
    const perTestFeedbackForPrompt = perTestFeedback.map((f) => {
      const t =
        f.testId && f.fileId && f.project
          ? testDb.getTest(f.testId, f.fileId, f.project)
          : undefined;
      return {
        testTitle: t?.title,
        comment: f.comment,
        updatedAt: f.updatedAt,
      };
    });

    const reportConfig = await service.getConfig();
    const reportLlmCfg = (reportConfig as any)?.llm ?? {};
    const trendContext = await buildTrendContextForReport(reportId);
    const builtPrompt = buildReportSummarySegments({
      reportId,
      categories,
      errorGroups,
      perTestAnalyses,
      perTestFeedback: perTestFeedbackForPrompt,
      trendContext,
      overrides: {
        systemPrompt: reportLlmCfg.customSystemPrompt,
        reportSummarySystemPrompt: reportLlmCfg.customReportSummarySystemPrompt,
        reportSummaryInstructions: reportLlmCfg.customReportSummaryInstructions,
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
    });

    llmTasksDb.complete(task.id, response.content, null, response.model, {
      usage: response.usage,
    });

    const totalFailures = Object.values(categories).reduce((s, c) => s + c, 0);
    failureSummaryDb.upsertSummary(reportId, project || '', totalFailures, categories);
    failureSummaryDb.updateLlmSummary(reportId, response.content, response.model);
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
      latestReports = reportDb.getLatestByProject(projectArg, 10);
    }
    if (latestReports.length === 0) {
      llmTasksDb.fail(task.id, 'No reports found for project');
      return;
    }

    const failureSummaryMap = new Map(
      failureSummaryDb.getSummariesByProject(project, 10).map((s) => [s.reportId, s] as const)
    );

    // Aggregate failures across the latest N reports by error_signature so the
    // project-summary prompt can lead with "what's actually broken" instead of
    // re-deriving it from per-run categories. Returns both the top-10 root
    // causes (by total occurrences) and the persistent subset (signature seen
    // in ≥3 distinct reports of the last N).
    const { rootCauses, persistentFailures } = aggregateProjectRootCauses(
      latestReports.map((r) => r.reportID),
      { topN: 10, persistentMinReports: 3 }
    );

    const projectConfig = await service.getConfig();
    const projectLlmCfg = (projectConfig as any)?.llm ?? {};
    const builtPrompt = buildProjectSummarySegments({
      project,
      runs: latestReports.map((r) => {
        const summary = failureSummaryMap.get(r.reportID);
        return {
          reportId: r.reportID,
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
        };
      }),
      rootCauses,
      persistentFailures,
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

    // Attach the latest reportId to the structured payload so the UI can map
    // unqualified codeRefs to a concrete report link.
    if (structured) {
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
    // Extract-on-read fallback: enrich missing message / attempts / evidence
    // from the on-disk report so the prompt sees the same shape regardless of
    // when the row was originally written.
    if (
      details &&
      (!details.message || !details.attempts || details.attempts.length === 0 || !details.evidence)
    ) {
      const extracted = await llmAnalysisQueue.extractDetailsFromReport(reportId, testId);
      if (extracted?.message && (!details.message || details.message.trim() === '')) {
        details.message = extracted.message;
        details.stackTrace ??= extracted.stackTrace;
      }
      if (extracted?.attempts && (!details.attempts || details.attempts.length === 0)) {
        details.attempts = extracted.attempts;
      }
      if (extracted?.evidence && !details.evidence) {
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
    reportSummarySystemPrompt: llmCfg.customReportSummarySystemPrompt as string | undefined,
    projectSummarySystemPrompt: llmCfg.customProjectSummarySystemPrompt as string | undefined,
    testAnalysisInstructions: llmCfg.customTestAnalysisInstructions as string | undefined,
    reportSummaryInstructions: llmCfg.customReportSummaryInstructions as string | undefined,
    projectSummaryInstructions: llmCfg.customProjectSummaryInstructions as string | undefined,
    project,
    errorCategory: heuristicCategory,
  };

  const { entries: crossProjectEntries, totalCount: crossProjectTotalCount } =
    buildCrossProjectEntries(testId, fileId, project, failedRun?.errorSignature ?? undefined);

  const { recentOutcomes, previousCategoriesChronological } = buildRecentHistoryFromRuns(runs);

  await enrichEnvironmentFromReport(details, reportId);

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

interface AggregateOptions {
  /** Cap on how many top-by-occurrence aggregates to return. */
  topN: number;
  /** Persistent threshold — signatures appearing in this many distinct reports
   *  or more are added to the `persistentFailures` array. */
  persistentMinReports: number;
}

/**
 * Walk the test_runs for the given report IDs and aggregate failures by
 * `error_signature`. Used by the project-summary prompt to lead with "what's
 * actually broken across the last N runs" rather than ask the model to
 * re-derive it from per-run categories.
 *
 * Synchronous SQLite reads only — safe to call inline from the queue worker.
 */
function aggregateProjectRootCauses(
  reportIds: string[],
  options: AggregateOptions
): { rootCauses: ProjectRootCause[]; persistentFailures: ProjectRootCause[] } {
  if (reportIds.length === 0) {
    return { rootCauses: [], persistentFailures: [] };
  }

  type Mutable = Omit<ProjectRootCause, 'reportsAffected'> & {
    reportsAffected: Set<string>;
    seenTestKeys: Set<string>;
  };
  const map = new Map<string, Mutable>();

  for (const reportId of reportIds) {
    const runs = testDb.getTestRunsByReport(reportId);
    for (const run of runs) {
      if (!run.errorSignature || !run.failureDetails) continue;
      let parsed: { message?: string } | null = null;
      try {
        parsed = JSON.parse(run.failureDetails);
      } catch {
        // Skip rows whose failure_details didn't parse — they still count for
        // signature aggregation but won't contribute a sample message.
      }

      let agg = map.get(run.errorSignature);
      if (!agg) {
        agg = {
          signature: run.errorSignature,
          category: run.failureCategory || 'unknown',
          occurrences: 0,
          reportsAffected: new Set<string>(),
          affectedTests: [],
          sampleMessage: '',
          seenTestKeys: new Set<string>(),
        };
        map.set(run.errorSignature, agg);
      }
      agg.occurrences++;
      agg.reportsAffected.add(reportId);
      if (!agg.sampleMessage && parsed?.message) {
        agg.sampleMessage = parsed.message;
      }
      const testKey = `${run.testId}::${run.fileId}`;
      if (!agg.seenTestKeys.has(testKey)) {
        agg.seenTestKeys.add(testKey);
        const t = testDb.getTest(run.testId, run.fileId, run.project);
        agg.affectedTests.push({
          testId: run.testId,
          title: t?.title || run.testId,
          filePath: t?.filePath || run.fileId,
        });
      }
    }
  }

  const all = [...map.values()].map((m): ProjectRootCause => {
    // Convert the mutable accumulator into the public shape (set → number).
    const { reportsAffected, seenTestKeys: _seen, ...rest } = m;
    return { ...rest, reportsAffected: reportsAffected.size };
  });

  // Sort by occurrences desc, with signature as tiebreaker for stable cache
  // prefixes when two signatures have identical counts.
  all.sort((a, b) =>
    b.occurrences !== a.occurrences
      ? b.occurrences - a.occurrences
      : a.signature.localeCompare(b.signature)
  );

  const rootCauses = all.slice(0, options.topN);

  // Enrich the top entries with the most recent LLM root-cause paragraph.
  // Scanning reports newest-first means the first hit is the latest analysis.
  for (const rc of rootCauses) {
    const repTest = rc.affectedTests[0];
    if (!repTest) continue;
    for (const reportId of reportIds) {
      const analysis = testAnalysisDb.getByTestAndReport(repTest.testId, reportId);
      if (analysis?.analysis) {
        rc.latestRootCause = extractRootCauseParagraph(analysis.analysis);
        rc.latestAnalysisReportId = reportId;
        break;
      }
    }
  }

  const persistentFailures = all.filter((a) => a.reportsAffected >= options.persistentMinReports);

  return { rootCauses, persistentFailures };
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
