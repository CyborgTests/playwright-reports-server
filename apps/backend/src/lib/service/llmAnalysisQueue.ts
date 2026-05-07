import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { llmService } from '../llm/index.js';
import type { FailureDetailsForPrompt } from '../llm/prompts/index.js';
import {
  buildProjectSummarySegments,
  buildReportSummarySegments,
  buildTestFailureSegments,
  computePromptVersion,
  fitPromptToBudget,
  renderSegmentsForDebug,
  TEST_FAILURE_ANALYSIS_SCHEMA,
  unescapeLiteralNewlines,
} from '../llm/prompts/index.js';
import type { SegmentedPrompt } from '../llm/types/index.js';
import { parseHtmlReport } from '../parser/index.js';
import { REPORTS_FOLDER } from '../storage/constants.js';
import { analysisFeedbackDb } from './db/analysisFeedback.sqlite.js';
import { getDatabase } from './db/db.js';
import { failureSummaryDb } from './db/failureSummary.sqlite.js';
import type { LlmTaskRow } from './db/llmTasks.sqlite.js';
import { llmTasksDb } from './db/llmTasks.sqlite.js';
import { testAnalysisDb } from './db/testAnalysis.sqlite.js';
import { testDb } from './db/tests.sqlite.js';
import { service } from './index.js';

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

const OUTPUT_RESERVE_TOKENS = 8000;
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
  outputReserveTokens: number = OUTPUT_RESERVE_TOKENS
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
      if (!llmService.isConfigured()) {
        this.schedulePoll();
        return;
      }

      const parallelRequests = await this.getParallelRequests();
      const tasks = llmTasksDb.claimNext(parallelRequests);

      if (tasks.length > 0) {
        await Promise.allSettled(tasks.map((task) => this.processTask(task)));
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
      const needsMessageEnrich = !details.message || details.message.trim() === '';
      const needsAttemptsEnrich = !details.attempts || details.attempts.length === 0;
      if (needsMessageEnrich || needsAttemptsEnrich) {
        const extracted = await this.extractDetailsFromReport(reportId, testId);
        if (extracted?.message && needsMessageEnrich) {
          details.message = extracted.message;
          details.stackTrace ??= extracted.stackTrace;
        }
        if (extracted?.attempts && needsAttemptsEnrich) {
          details.attempts = extracted.attempts;
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

    // Reuse the previous analysis when the error message + stack are identical.
    // Four guards invalidate reuse:
    //   1. User-driven retry (task.isRetry) — the user explicitly asked for a fresh run,
    //      typically after switching models. Reusing would echo the prior model name and
    //      analysis verbatim, defeating the point of the retry.
    //   2. Own-project feedback newer than the previous analysis — otherwise feedback
    //      never reaches the model after the first generation.
    //   3. Prior analysis older than REUSE_TTL_DAYS — environments drift; a "transient"
    //      diagnosis from last week may be a real bug today. Force a fresh look.
    //   4. Same error_signature has recurred more than REUSE_RECURRENCE_LIMIT times
    //      since the prior analysis was created — strong signal that the issue is
    //      persistent, not transient, and deserves re-evaluation.
    if (previousAnalysis?.analysis && !task.isRetry) {
      const prevAnalysisAt = previousAnalysis.updatedAt || previousAnalysis.createdAt;
      const feedbackIsNewer =
        feedback &&
        prevAnalysisAt &&
        new Date(feedback.updatedAt).getTime() > new Date(prevAnalysisAt).getTime();

      const prevAnalysisAgeMs = prevAnalysisAt
        ? Date.now() - new Date(prevAnalysisAt).getTime()
        : 0;
      const ttlMs = REUSE_TTL_DAYS * 24 * 60 * 60 * 1000;
      const ttlExpired = prevAnalysisAgeMs > ttlMs;

      let recurrenceExceeded = false;
      if (failedRun?.errorSignature && prevAnalysisAt) {
        const db = getDatabase();
        const recurrenceRow = db
          .prepare(
            `SELECT COUNT(*) as count FROM test_runs
             WHERE testId = ? AND fileId = ? AND project = ?
               AND error_signature = ? AND createdAt > ?`
          )
          .get(testId, fileId, project, failedRun.errorSignature, prevAnalysisAt) as {
          count: number;
        };
        recurrenceExceeded = recurrenceRow.count > REUSE_RECURRENCE_LIMIT;
      }

      if (ttlExpired) {
        console.log(
          `[llmQueue] Task ${task.id}: prior analysis older than ${REUSE_TTL_DAYS}d — forcing fresh analysis for test ${testId}`
        );
      } else if (recurrenceExceeded) {
        console.log(
          `[llmQueue] Task ${task.id}: signature recurred >${REUSE_RECURRENCE_LIMIT} times since prior analysis — forcing fresh analysis for test ${testId}`
        );
      }

      if (!feedbackIsNewer && !ttlExpired && !recurrenceExceeded) {
        const db = getDatabase();
        const prevTask = db
          .prepare(
            `SELECT prompt FROM llm_tasks WHERE testId = ? AND status = 'completed' AND prompt IS NOT NULL ORDER BY completedAt DESC LIMIT 1`
          )
          .get(testId) as { prompt: string } | undefined;

        if (prevTask?.prompt) {
          const errorSignature = `${details.message}\n${details.stackTrace || ''}`.trim();
          const prevErrorMatch = prevTask.prompt.match(/## Error Message\n```\n([\s\S]*?)```/);
          const prevStackMatch = prevTask.prompt.match(/## Stack Trace\n```\n([\s\S]*?)```/);
          const prevSignature =
            `${prevErrorMatch?.[1]?.trim() || ''}\n${prevStackMatch?.[1]?.trim() || ''}`.trim();

          if (errorSignature && prevSignature && errorSignature === prevSignature) {
            console.log(
              `[llmQueue] Task ${task.id}: same error as previous analysis, reusing result for test ${testId}`
            );
            const attempt = details.attempt ?? 1;
            // Reused = 0 tokens (no LLM call); inherit promptVersion from the source row.
            const reuseExtras = {
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              promptVersion: previousAnalysis.promptVersion ?? undefined,
            };
            llmTasksDb.complete(
              task.id,
              previousAnalysis.analysis,
              previousAnalysis.category ?? undefined,
              previousAnalysis.model ?? undefined,
              reuseExtras
            );
            // Mark the new row as reused so consumers can show "♻ Reused" rather than
            // surface it as a fresh LLM-generated analysis.
            testAnalysisDb.upsert(
              testId,
              fileId,
              project,
              reportId,
              previousAnalysis.analysis,
              previousAnalysis.category ?? undefined,
              previousAnalysis.model ?? undefined,
              attempt,
              previousAnalysis.id,
              reuseExtras
            );

            if (failedRun?.runId && previousAnalysis.category) {
              testDb.updateFailureCategory(failedRun.runId, previousAnalysis.category);
            }

            if (reportId && llmTasksDb.areAllTestTasksComplete(reportId)) {
              console.log(`[llmQueue] All test analyses for report ${reportId} complete`);
            }
            return;
          }
        }
      }
    }

    const config = await service.getConfig();
    const warningThreshold = (config as any)?.testManagement?.warningThresholdPercentage ?? 2;
    const flakinessScore = failedRun?.flakinessScore ?? 0;

    // Runtime prompt overrides from settings. Each override replaces the
    // corresponding baseline; mustache vars are substituted from a per-template
    // allowlist (see prompts/index.ts).
    const llmCfg = (config as any)?.llm ?? {};
    const { detectFailureCategory, isKnownCategory } = await import('./testManagement.js');
    const heuristicCategory = detectFailureCategory(details.message);
    const promptOverrides = {
      systemPrompt: llmCfg.customSystemPrompt as string | undefined,
      testAnalysisInstructions: llmCfg.customTestAnalysisInstructions as string | undefined,
      reportSummaryInstructions: llmCfg.customReportSummaryInstructions as string | undefined,
      projectSummaryInstructions: llmCfg.customProjectSummaryInstructions as string | undefined,
      project,
      errorCategory: heuristicCategory,
    };

    // Same-test feedback in other projects: pull a wider candidate pool, score
    // each (signature match wins; recency and prior-analysis attached are
    // tiebreakers), take the top N. Purely additive context — does NOT
    // invalidate reuse (guard above checks only own-project).
    const CROSS_PROJECT_CANDIDATE_POOL = 25;
    const CROSS_PROJECT_KEEP = 5;
    const relatedRows = analysisFeedbackDb.getRelatedByTest(
      testId,
      fileId,
      project,
      CROSS_PROJECT_CANDIDATE_POOL
    );
    const currentSignature = failedRun?.errorSignature ?? undefined;
    const scoreEntry = (r: (typeof relatedRows)[number]): number => {
      const sigMatch =
        !!currentSignature && !!r.errorSignature && r.errorSignature === currentSignature;
      const ageMs = Date.now() - new Date(r.updatedAt).getTime();
      const days = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
      // Signature exact match dominates (>=100). Recency adds up to 30 (today=30, decays
      // toward 0 with age). Having a prior LLM analysis attached adds 5 (tiebreaker only).
      return (sigMatch ? 100 : 0) + 30 / (1 + days) + (r.latestAnalysis ? 5 : 0);
    };
    const ranked = [...relatedRows]
      .map((r) => ({ row: r, score: scoreEntry(r) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, CROSS_PROJECT_KEEP)
      .map(({ row: r }) => r);
    const crossProjectEntries = ranked.map((r) => ({
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

    const builtPrompt = buildTestFailureSegments({
      failureDetails: details,
      historicalContext: {
        totalRuns,
        recentFailureCount: recentFailures,
        isFlaky: flakinessScore >= warningThreshold,
        isNewFailure,
      },
      feedback,
      crossProjectEntries,
      crossProjectTotalCount: relatedRows.length,
      overrides: promptOverrides,
    });

    // Attach the first image from the failure's attachments — regardless of
    // failure category. A screenshot of the page at failure time helps
    // vision-capable models reason about most failure types, not just visual
    // ones. The LLMService layer (multimodal mode + blocklist) gates whether
    // it actually goes on the wire and auto-falls-back to text-only when the
    // active model rejects images.
    if (details.attachments && details.attachments.length > 0) {
      const imageAtt = details.attachments.find((a) => a.contentType?.startsWith('image/'));
      if (imageAtt) {
        const img = await readImageAttachment(reportId, imageAtt);
        if (img) {
          const failureIdx = builtPrompt.segments.findIndex((s) => s.id === 'current_failure');
          if (failureIdx >= 0) {
            builtPrompt.segments[failureIdx] = {
              ...builtPrompt.segments[failureIdx],
              images: [img],
            };
            console.log(
              `[llmQueue] Task ${task.id}: attached screenshot ${imageAtt.path} (${img.mediaType})`
            );
          }
        }
      }
    }

    // promptVersion is computed from the ORIGINAL prompt (template hash), not
    // the post-fit one — fit only mutates data segments, not templateOnly ones.
    const promptVersion = computePromptVersion(builtPrompt);

    await llmService.initialize();
    const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(builtPrompt);

    const debugPrompt = renderSegmentsForDebug(segmentedPrompt);
    llmTasksDb.updatePrompt(task.id, debugPrompt);

    console.log(
      `[llmQueue] Task ${task.id}: segments=${segmentedPrompt.segments.length} chars=${debugPrompt.length} ver=${promptVersion} for test ${testId}${fitLog ? ` ${fitLog}` : ''}`
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

    // Prefer the typed structured output when present; otherwise parse the
    // text response (regex+fences) as a backwards-compat fallback for models
    // that don't support schema-driven output.
    let llmCategory: string | null = null;
    let analysis = response.content;
    if (response.structuredOutput && typeof response.structuredOutput === 'object') {
      const so = response.structuredOutput as { category?: string; analysis?: string };
      if (so.category) llmCategory = so.category;
      if (so.analysis) analysis = so.analysis;
    } else {
      try {
        let jsonStr = response.content.trim();
        const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();
        const parsed = JSON.parse(jsonStr);
        if (parsed.category) llmCategory = parsed.category;
        if (parsed.analysis) analysis = parsed.analysis;
      } catch {
        // LLM didn't return JSON — leave llmCategory null and fall back to heuristic below.
      }
    }
    // Some local models emit markdown with literal `\n` escapes instead of
    // actual newlines (JSON-string style without the envelope). Unwind so
    // headers and code fences render correctly downstream.
    analysis = unescapeLiteralNewlines(analysis);

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
      promptVersion,
    };
    llmTasksDb.complete(task.id, analysis, category, response.model, completionExtras);
    testAnalysisDb.upsert(
      testId,
      fileId,
      project,
      reportId,
      analysis,
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
   * Used as fallback when failure_details is not stored on the test_run record (older reports).
   *
   * Playwright stores error info in different ways:
   * - results[].message — direct error text (older Playwright versions)
   * - results[].attachments with name "error-context" — .md file with page snapshot / error context
   * - results[].attachments with name "stderr"/"stdout" — captured output
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

          let message = '';
          let errorContextContent = '';
          const allAttachments: Array<{ name: string; path: string; contentType: string }> = [];
          // Per-attempt timeline. Includes passing retries so the LLM can spot
          // "flaky → eventually passed" patterns vs "never recovered".
          const attempts: Array<{
            attempt: number;
            status: string;
            message?: string;
            durationMs?: number;
          }> = [];

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

              if (result.status === 'passed') continue;

              if (result.message && !message) {
                message = result.message;
              }

              // Read the error-context attachment (Playwright's "Copy prompt" source).
              if (result.attachments) {
                for (const att of result.attachments) {
                  if (att.name === 'error-context' && att.path && !errorContextContent) {
                    try {
                      errorContextContent = await fs.readFile(
                        path.join(reportDir, att.path),
                        'utf-8'
                      );
                    } catch {
                      // attachment file may be missing — fall through
                    }
                  }
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

          // Trace ZIP carries structured error + stack — richest source when present.
          let traceError: { message: string; stack: string } | null = null;
          const traceAtt = allAttachments.find((a) => a.name === 'trace' && a.path);
          if (traceAtt) {
            traceError = await this.extractErrorFromTrace(reportDir, traceAtt.path);
          }

          // Pick the best message source in order: trace, result.message, synthetic fallback.
          // The DOM snapshot is appended as supplementary context, not the error itself.
          const MAX_CONTEXT_CHARS = 4000;
          let bestMessage = '';
          let stackTrace: string | undefined;

          if (traceError) {
            bestMessage = stripAnsi(traceError.message);
            stackTrace = traceError.stack;
          }
          if (!bestMessage && message) {
            bestMessage = message;
            const stackIndex = message.indexOf('\n    at ');
            if (stackIndex > 0) {
              stackTrace = message.substring(stackIndex);
              bestMessage = message.substring(0, stackIndex);
            }
          }
          if (!bestMessage) {
            bestMessage = `Test ${test.outcome}: ${test.title}`;
          }
          if (errorContextContent) {
            const truncatedContext =
              errorContextContent.length > MAX_CONTEXT_CHARS
                ? errorContextContent.substring(0, MAX_CONTEXT_CHARS) + '\n\n... (truncated)'
                : errorContextContent;
            bestMessage += `\n\n# Page Context (DOM snapshot)\n\n${truncatedContext}`;
          }

          return {
            message: bestMessage,
            stackTrace,
            testTitle: test.title,
            filePath: file.fileName || file.fileId,
            location: test.location,
            attachments: allAttachments,
            attempt: 1,
            status: test.outcome,
            attempts: attempts.length > 0 ? attempts : undefined,
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
    const builtPrompt = buildReportSummarySegments({
      reportId,
      categories,
      errorGroups,
      perTestAnalyses,
      perTestFeedback: perTestFeedbackForPrompt,
      overrides: {
        systemPrompt: reportLlmCfg.customSystemPrompt,
        reportSummaryInstructions: reportLlmCfg.customReportSummaryInstructions,
        project: project ?? undefined,
      },
    });
    const promptVersion = computePromptVersion(builtPrompt);

    await llmService.initialize();
    const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(builtPrompt);

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
      promptVersion,
    });

    const totalFailures = Object.values(categories).reduce((s, c) => s + c, 0);
    // Map to the ErrorGroup shape the DB expects (serialized as JSON).
    const dbErrorGroups = errorGroups.map((g) => ({
      pattern: g.sampleMessage,
      count: g.count,
      category: g.category,
      testIds: g.affectedTests,
    }));
    failureSummaryDb.upsertSummary(
      reportId,
      project || '',
      totalFailures,
      categories,
      dbErrorGroups
    );
    failureSummaryDb.updateLlmSummary(reportId, response.content, response.model);
  }

  private async processProjectSummary(task: LlmTaskRow): Promise<void> {
    const { project } = task;
    if (!project) {
      llmTasksDb.fail(task.id, 'Missing project');
      return;
    }

    const { reportDb } = await import('./db/reports.sqlite.js');

    const latestReports = reportDb.getLatestByProject(project, 10);
    if (latestReports.length === 0) {
      llmTasksDb.fail(task.id, 'No reports found for project');
      return;
    }

    const failureSummaryMap = new Map(
      failureSummaryDb.getSummariesByProject(project, 10).map((s) => [s.reportId, s] as const)
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
      overrides: {
        systemPrompt: projectLlmCfg.customSystemPrompt,
        projectSummaryInstructions: projectLlmCfg.customProjectSummaryInstructions,
      },
    });
    const promptVersion = computePromptVersion(builtPrompt);

    await llmService.initialize();
    const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(builtPrompt);

    const debugPrompt = renderSegmentsForDebug(segmentedPrompt);
    llmTasksDb.updatePrompt(task.id, debugPrompt);
    if (fitLog) console.log(`[llmQueue] Task ${task.id}: ${fitLog}`);

    const projectTemp =
      projectLlmCfg.projectSummaryTemperature ?? TASK_TEMPERATURE_DEFAULTS.projectSummary;
    const response = await llmService.sendSegmentedMessage(segmentedPrompt, {
      temperature: projectTemp,
    });

    llmTasksDb.complete(task.id, response.content, null, response.model, {
      usage: response.usage,
      promptVersion,
    });
  }
  /**
   * Extract error message and stack trace from a Playwright trace ZIP file.
   * The trace contains a test.trace JSONL file with error entries.
   */
  private async extractErrorFromTrace(
    reportDir: string,
    tracePath: string
  ): Promise<{ message: string; stack: string } | null> {
    try {
      const zipBuffer = await fs.readFile(path.join(reportDir, tracePath));
      const zip = await JSZip.loadAsync(zipBuffer);

      const testTraceFile = zip.file('test.trace');
      if (!testTraceFile) return null;

      const content = await testTraceFile.async('string');
      const lines = content.split('\n').filter((l: string) => l.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // "error" entries carry the structured error message + stack.
          if (entry.type === 'error' && entry.message) {
            const stackLines = Array.isArray(entry.stack)
              ? entry.stack
                  .map(
                    (s: { file?: string; line?: number; column?: number; function?: string }) =>
                      `    at ${s.function ? s.function + ' ' : ''}(${s.file}:${s.line}:${s.column})`
                  )
                  .join('\n')
              : typeof entry.stack === 'string'
                ? entry.stack
                : '';

            return {
              message: entry.message,
              stack: stackLines,
            };
          }
          if (entry.type === 'after' && entry.error?.message) {
            return {
              message: entry.error.message,
              stack: typeof entry.error.stack === 'string' ? entry.error.stack : '',
            };
          }
        } catch {
          // skip unparseable lines
        }
      }

      return null;
    } catch (error) {
      console.error(`[llmQueue] Failed to read trace ${tracePath}:`, error);
      return null;
    }
  }
}

export const llmAnalysisQueue = LlmAnalysisQueue.getInstance();

export interface TestAnalysisRequest {
  segmentedPrompt: SegmentedPrompt;
  debugPrompt: string;
  promptVersion: string;
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
    if (details && (!details.message || !details.attempts || details.attempts.length === 0)) {
      const extracted = await llmAnalysisQueue.extractDetailsFromReport(reportId, testId);
      if (extracted?.message && (!details.message || details.message.trim() === '')) {
        details.message = extracted.message;
        details.stackTrace ??= extracted.stackTrace;
      }
      if (extracted?.attempts && (!details.attempts || details.attempts.length === 0)) {
        details.attempts = extracted.attempts;
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
  const warningThreshold = (config as any)?.testManagement?.warningThresholdPercentage ?? 2;
  const flakinessScore = failedRun?.flakinessScore ?? 0;
  const llmCfg = (config as any)?.llm ?? {};
  const { detectFailureCategory } = await import('./testManagement.js');
  const heuristicCategory = detectFailureCategory(details.message);

  const promptOverrides = {
    systemPrompt: llmCfg.customSystemPrompt as string | undefined,
    testAnalysisInstructions: llmCfg.customTestAnalysisInstructions as string | undefined,
    reportSummaryInstructions: llmCfg.customReportSummaryInstructions as string | undefined,
    projectSummaryInstructions: llmCfg.customProjectSummaryInstructions as string | undefined,
    project,
    errorCategory: heuristicCategory,
  };

  const relatedRows = analysisFeedbackDb.getRelatedByTest(testId, fileId, project, 25);
  const currentSignature = failedRun?.errorSignature ?? undefined;
  const ranked = [...relatedRows]
    .map((r) => {
      const sigMatch =
        !!currentSignature && !!r.errorSignature && r.errorSignature === currentSignature;
      const ageMs = Date.now() - new Date(r.updatedAt).getTime();
      const days = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
      return {
        row: r,
        score: (sigMatch ? 100 : 0) + 30 / (1 + days) + (r.latestAnalysis ? 5 : 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ row: r }) => r);
  const crossProjectEntries = ranked.map((r) => ({
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

  const builtPrompt = buildTestFailureSegments({
    failureDetails: details,
    historicalContext: {
      totalRuns,
      recentFailureCount: recentFailures,
      isFlaky: flakinessScore >= warningThreshold,
      isNewFailure,
    },
    feedback,
    crossProjectEntries,
    crossProjectTotalCount: relatedRows.length,
    overrides: promptOverrides,
  });

  if (details.attachments && details.attachments.length > 0) {
    const imageAtt = details.attachments.find((a) => a.contentType?.startsWith('image/'));
    if (imageAtt) {
      const img = await readImageAttachment(reportId, imageAtt);
      if (img) {
        const failureIdx = builtPrompt.segments.findIndex((s) => s.id === 'current_failure');
        if (failureIdx >= 0) {
          builtPrompt.segments[failureIdx] = {
            ...builtPrompt.segments[failureIdx],
            images: [img],
          };
        }
      }
    }
  }

  const promptVersion = computePromptVersion(builtPrompt);
  await llmService.initialize();
  const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(builtPrompt);
  const debugPrompt = renderSegmentsForDebug(segmentedPrompt);

  return {
    segmentedPrompt,
    debugPrompt,
    promptVersion,
    heuristicCategory,
    details,
    failedRun,
    fitLog,
  };
}
