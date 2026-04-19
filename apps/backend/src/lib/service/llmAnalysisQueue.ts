import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { llmService } from '../llm/index.js';
import { testFailureAnalysisPrompt, reportFailureSummaryPrompt } from '../llm/prompts/index.js';
import type { FailureDetailsForPrompt } from '../llm/prompts/index.js';
import { parseHtmlReport } from '../parser/index.js';
import { REPORTS_FOLDER } from '../storage/constants.js';
import { llmTasksDb } from './db/llmTasks.sqlite.js';
import type { LlmTaskRow } from './db/llmTasks.sqlite.js';
import { testAnalysisDb } from './db/testAnalysis.sqlite.js';
import { failureSummaryDb } from './db/failureSummary.sqlite.js';
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
    const failedRun = runs.find((r) => r.failureDetails && r.reportId === reportId)
      || runs.find((r) => r.failureDetails)
      || runs.find((r) => r.reportId === reportId)
      || runs[0];

    let details: FailureDetailsForPrompt;

    if (failedRun?.failureDetails) {
      // Stored failure details available
      try {
        details = JSON.parse(failedRun.failureDetails);
      } catch {
        llmTasksDb.fail(task.id, 'Failed to parse failure details JSON');
        return;
      }
    } else {
      // Fall back: read from report HTML on disk
      const extracted = await this.extractDetailsFromReport(reportId, testId, fileId);
      if (!extracted) {
        llmTasksDb.fail(task.id, `No failure details found — test ${testId} not found in report ${reportId}`);
        return;
      }
      details = extracted;
    }

    // Strip ANSI escape codes from message and stack trace
    if (details.message) details.message = stripAnsi(details.message);
    if (details.stackTrace) details.stackTrace = stripAnsi(details.stackTrace);

    // Build historical context
    const totalRuns = testDb.getTestRunCount(testId, fileId, project);
    const recentFailures = runs.filter((r) => r.outcome === 'unexpected' || r.outcome === 'failed').length;

    const previousAnalysis = testAnalysisDb.getByTest(testId, fileId, project);
    const isNewFailure = !previousAnalysis;

    // Check flakiness against warning threshold from config
    const config = await service.getConfig();
    const warningThreshold = (config as any)?.testManagement?.warningThresholdPercentage ?? 2;
    const flakinessScore = failedRun?.flakinessScore ?? 0;

    const prompt = testFailureAnalysisPrompt(details, {
      totalRuns,
      recentFailureCount: recentFailures,
      isFlaky: flakinessScore >= warningThreshold,
      isNewFailure,
    });

    // Store prompt on task for debugging (truncated to 10k chars)
    llmTasksDb.updatePrompt(task.id, prompt.substring(0, 10000));

    // Truncate prompt if too large for LLM (most providers have ~128k context but smaller is better)
    const MAX_PROMPT_CHARS = 30000;
    const finalPrompt = prompt.length > MAX_PROMPT_CHARS
      ? prompt.substring(0, MAX_PROMPT_CHARS) + '\n\n... (prompt truncated due to size)'
      : prompt;

    console.log(`[llmQueue] Task ${task.id}: prompt ${finalPrompt.length} chars for test ${testId}`);

    await llmService.initialize();
    const response = await llmService.sendMessage(finalPrompt);

    // Try to parse structured response
    let category = 'unknown';
    let analysis = response.content;
    try {
      const parsed = JSON.parse(response.content);
      if (parsed.category) category = parsed.category;
      if (parsed.analysis) analysis = parsed.analysis;
    } catch {
      // LLM didn't return JSON, use raw content as analysis
    }

    // Store results
    llmTasksDb.complete(task.id, analysis, category, response.model);
    testAnalysisDb.upsert(testId, fileId, project, reportId, analysis, category, response.model);

    // Update failure_category on the test_run
    if (failedRun?.runId) {
      testDb.updateFailureCategory(failedRun.runId, category);
    }

    // Check if all test tasks for this report are done
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
    testId: string,
    fileId: string
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
          // Match by testId (primary unique test identifier)
          if (test.testId !== testId) continue;

          // Collect error context from all results
          let message = '';
          let errorContextContent = '';
          const allAttachments: Array<{ name: string; path: string; contentType: string }> = [];

          if (test.results) {
            for (let i = 0; i < test.results.length; i++) {
              const result = test.results[i];
              if (result.status === 'passed') continue;

              // Direct error message
              if (result.message && !message) {
                message = result.message;
              }

              // Read error-context attachment from disk (Playwright's "Copy prompt" source)
              if (result.attachments) {
                for (const att of result.attachments) {
                  if (att.name === 'error-context' && att.path && !errorContextContent) {
                    try {
                      errorContextContent = await fs.readFile(
                        path.join(reportDir, att.path),
                        'utf-8'
                      );
                    } catch {
                      // File may not exist
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

          // Also collect test-level attachments
          if (test.attachments) {
            for (const att of test.attachments) {
              allAttachments.push({
                name: att.name,
                path: att.path,
                contentType: att.contentType,
              });
            }
          }

          // Read error details from trace ZIP (richest source — has structured error + stack)
          let traceError: { message: string; stack: string } | null = null;
          const traceAtt = allAttachments.find(a => a.name === 'trace' && a.path);
          if (traceAtt) {
            traceError = await this.extractErrorFromTrace(reportDir, traceAtt.path);
          }

          // Build the best possible message, combining all sources:
          // 1. Trace error message + stack (most structured)
          // 2. error-context attachment (page snapshot — truncated to avoid LLM timeout)
          // 3. Direct result.message
          // 4. Fallback to test outcome
          const MAX_CONTEXT_CHARS = 4000; // Keep prompt reasonable for LLM context window
          let bestMessage = '';
          let stackTrace: string | undefined;

          if (traceError) {
            bestMessage = stripAnsi(traceError.message);
            stackTrace = traceError.stack;
          }
          if (errorContextContent) {
            const truncatedContext = errorContextContent.length > MAX_CONTEXT_CHARS
              ? errorContextContent.substring(0, MAX_CONTEXT_CHARS) + '\n\n... (truncated)'
              : errorContextContent;
            bestMessage += (bestMessage ? '\n\n# Page Context\n\n' : '') + truncatedContext;
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

    // Check if all test analyses are done — requeue with retry limit if not
    if (!llmTasksDb.areAllTestTasksComplete(reportId)) {
      if (task.retryCount >= 20) {
        llmTasksDb.fail(task.id, 'Timed out waiting for test analyses to complete');
        return;
      }
      llmTasksDb.requeueWithRetryIncrement(task.id);
      console.log(`[llmQueue] Report summary ${task.id} requeued (${task.retryCount + 1}/20) — waiting for test analyses`);
      return;
    }

    // Gather per-test analyses
    const testAnalyses = testAnalysisDb.getByReport(reportId);
    const categories: Record<string, number> = {};
    const perTestAnalyses: Array<{ testTitle: string; category: string; analysis: string }> = [];

    for (const ta of testAnalyses) {
      if (ta.category) {
        categories[ta.category] = (categories[ta.category] || 0) + 1;
      }
      // Get test title
      const test = testDb.getTest(ta.testId, ta.fileId, ta.project);
      perTestAnalyses.push({
        testTitle: test?.title || ta.testId,
        category: ta.category || 'unknown',
        analysis: ta.analysis || '',
      });
    }

    // Build error groups from test_runs for this report
    const errorGroups: Array<{ signature: string; category: string; count: number; sampleMessage: string; affectedTests: string[] }> = [];
    // Group by error_signature
    const signatureMap = new Map<string, { category: string; count: number; message: string; tests: Set<string> }>();

    // Query test_runs by reportId
    const reportRuns = testDb.getTestRunsByReport(reportId);
    for (const run of reportRuns) {
      if (!run.errorSignature || !run.failureDetails) continue;
      let details: any;
      try { details = JSON.parse(run.failureDetails); } catch { continue; }

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

    const prompt = reportFailureSummaryPrompt(reportId, categories, errorGroups, perTestAnalyses);

    await llmService.initialize();
    const response = await llmService.sendMessage(prompt);

    llmTasksDb.complete(task.id, response.content, null, response.model);

    // Store in failure summary table
    const totalFailures = Object.values(categories).reduce((s, c) => s + c, 0);
    // Map to ErrorGroup shape expected by the DB (serialized as JSON)
    const dbErrorGroups = errorGroups.map((g) => ({
      pattern: g.sampleMessage,
      count: g.count,
      category: g.category,
      testIds: g.affectedTests,
    }));
    failureSummaryDb.upsertSummary(reportId, project || '', totalFailures, categories, dbErrorGroups);
    failureSummaryDb.updateLlmSummary(reportId, response.content);
  }

  private async processProjectSummary(task: LlmTaskRow): Promise<void> {
    const { project } = task;
    if (!project) {
      llmTasksDb.fail(task.id, 'Missing project');
      return;
    }

    // Import the prompt function
    const { projectFailureSummaryPrompt } = await import('../llm/prompts/index.js');

    const summaries = failureSummaryDb.getSummariesByProject(project, 10);
    if (summaries.length === 0) {
      llmTasksDb.fail(task.id, 'No report summaries found for project');
      return;
    }

    const prompt = projectFailureSummaryPrompt(project, summaries.map((s) => ({
      reportId: s.reportId,
      totalFailures: s.totalFailures,
      categories: s.categories,
      llmSummary: s.llmSummary ?? undefined,
      createdAt: s.createdAt,
    })));

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

      // Find the "error" type entry — it has the structured error
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'error' && entry.message) {
            const stackLines = Array.isArray(entry.stack)
              ? entry.stack.map((s: { file?: string; line?: number; column?: number; function?: string }) =>
                  `    at ${s.function ? s.function + ' ' : ''}(${s.file}:${s.line}:${s.column})`
                ).join('\n')
              : typeof entry.stack === 'string' ? entry.stack : '';

            return {
              message: entry.message,
              stack: stackLines,
            };
          }
          // Also check "after" entries with error field
          if (entry.type === 'after' && entry.error?.message) {
            return {
              message: entry.error.message,
              stack: typeof entry.error.stack === 'string' ? entry.error.stack : '',
            };
          }
        } catch {
          // Skip unparseable lines
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
