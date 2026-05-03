import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { llmService } from '../llm/index.js';
import type { FailureDetailsForPrompt } from '../llm/prompts/index.js';
import {
  buildCrossProjectContext,
  buildFeedbackContext,
  buildPerTestFeedbackContext,
  reportFailureSummaryPrompt,
  testFailureAnalysisPrompt,
} from '../llm/prompts/index.js';
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

    // Get failure details — try stored data first, fall back to parsing report HTML
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
      // attachments (error-context, trace) which carry the real error text.
      if (!details.message || details.message.trim() === '') {
        const extracted = await this.extractDetailsFromReport(reportId, testId);
        if (extracted?.message) {
          details.message = extracted.message;
          details.stackTrace ??= extracted.stackTrace;
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
    // Guard: own-project feedback newer than the previous analysis must invalidate reuse,
    // otherwise feedback never reaches the model after the first generation.
    if (previousAnalysis?.analysis) {
      const prevAnalysisAt = previousAnalysis.updatedAt || previousAnalysis.createdAt;
      const feedbackIsNewer =
        feedback &&
        prevAnalysisAt &&
        new Date(feedback.updatedAt).getTime() > new Date(prevAnalysisAt).getTime();

      if (!feedbackIsNewer) {
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
            llmTasksDb.complete(
              task.id,
              previousAnalysis.analysis,
              previousAnalysis.category ?? undefined,
              previousAnalysis.model ?? undefined
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
              previousAnalysis.id
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

    const basePrompt = testFailureAnalysisPrompt(details, {
      totalRuns,
      recentFailureCount: recentFailures,
      isFlaky: flakinessScore >= warningThreshold,
      isNewFailure,
    });

    // Phase 2: same-test feedback in other projects, labeled with age + signature-match.
    // Purely additive context — does NOT invalidate reuse (guard above checks only own-project).
    const relatedRows = analysisFeedbackDb.getRelatedByTest(testId, fileId, project);
    const currentSignature = failedRun?.errorSignature ?? undefined;
    const crossProjectEntries = relatedRows.map((r) => ({
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

    const prompt =
      basePrompt + buildFeedbackContext(feedback) + buildCrossProjectContext(crossProjectEntries);

    // Store prompt on task for debugging (truncated to 10k chars)
    llmTasksDb.updatePrompt(task.id, prompt.substring(0, 10000));

    // Truncate prompt if too large for LLM (most providers have ~128k context but smaller is better)
    const MAX_PROMPT_CHARS = 30000;
    const finalPrompt =
      prompt.length > MAX_PROMPT_CHARS
        ? prompt.substring(0, MAX_PROMPT_CHARS) + '\n\n... (prompt truncated due to size)'
        : prompt;

    console.log(
      `[llmQueue] Task ${task.id}: prompt ${finalPrompt.length} chars for test ${testId}`
    );

    await llmService.initialize();
    const response = await llmService.sendMessage(finalPrompt);

    // Try to parse structured response (LLM may wrap JSON in markdown code fences).
    let llmCategory: string | null = null;
    let analysis = response.content;
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

    // LLM precedence rule: the LLM may override only when it returns a known category AND
    // either the heuristic was 'unknown' or the LLM's choice agrees with the heuristic.
    // Otherwise we trust the heuristic — preventing the "two classifiers disagree → label
    // flips between runs" problem.
    const { detectFailureCategory, isKnownCategory } = await import('./testManagement.js');
    const heuristicCategory = detectFailureCategory(details.message);
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
    llmTasksDb.complete(task.id, analysis, category, response.model);
    testAnalysisDb.upsert(
      testId,
      fileId,
      project,
      reportId,
      analysis,
      category,
      response.model,
      attempt
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
  private async extractDetailsFromReport(
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

          if (test.results) {
            for (let i = 0; i < test.results.length; i++) {
              const result = test.results[i];
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

    const basePrompt = reportFailureSummaryPrompt(
      reportId,
      categories,
      errorGroups,
      perTestAnalyses
    );

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
    const prompt = basePrompt + buildPerTestFeedbackContext(perTestFeedbackForPrompt);

    await llmService.initialize();
    const response = await llmService.sendMessage(prompt);

    llmTasksDb.complete(task.id, response.content, null, response.model);

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
    failureSummaryDb.updateLlmSummary(reportId, response.content);
  }

  private async processProjectSummary(task: LlmTaskRow): Promise<void> {
    const { project } = task;
    if (!project) {
      llmTasksDb.fail(task.id, 'Missing project');
      return;
    }

    const { projectFailureSummaryPrompt } = await import('../llm/prompts/index.js');
    const { reportDb } = await import('./db/reports.sqlite.js');

    const latestReports = reportDb.getLatestByProject(project, 10);
    if (latestReports.length === 0) {
      llmTasksDb.fail(task.id, 'No reports found for project');
      return;
    }

    const failureSummaryMap = new Map(
      failureSummaryDb.getSummariesByProject(project, 10).map((s) => [s.reportId, s] as const)
    );

    const prompt = projectFailureSummaryPrompt(
      project,
      latestReports.map((r) => {
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
      })
    );

    await llmService.initialize();
    const response = await llmService.sendMessage(prompt);

    llmTasksDb.complete(task.id, response.content, null, response.model);
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
