import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { llmService } from '../lib/llm/index.js';
import {
  DeleteFeedbackRequestSchema,
  FeedbackRegenerateRequestSchema,
  GetFeedbackQuerySchema,
  GetRelatedFeedbackQuerySchema,
  UpsertFeedbackRequestSchema,
} from '../lib/schemas/index.js';
import { analyticsService } from '../lib/service/analytics.js';
import { analysisFeedbackDb } from '../lib/service/db/analysisFeedback.sqlite.js';
import { getDatabase } from '../lib/service/db/db.js';
import { failureSummaryDb } from '../lib/service/db/failureSummary.sqlite.js';
import { llmTasksDb } from '../lib/service/db/llmTasks.sqlite.js';
import { reportDb } from '../lib/service/db/reports.sqlite.js';
import { testAnalysisDb } from '../lib/service/db/testAnalysis.sqlite.js';
import { testDb } from '../lib/service/db/tests.sqlite.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

function feedbackRowToShared(
  row: {
    id: string;
    testId: string | null;
    fileId: string | null;
    project: string;
    reportId: string | null;
    errorSignature: string | null;
    comment: string;
    createdAt: string;
    updatedAt: string;
  } | null
) {
  if (!row) return null;
  return {
    id: row.id,
    testId: row.testId ?? undefined,
    fileId: row.fileId ?? undefined,
    project: row.project,
    reportId: row.reportId ?? undefined,
    errorSignature: row.errorSignature ?? undefined,
    comment: row.comment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Resolve fileId+project+errorSignature for a test from (testId, reportId).
// Used when the caller (e.g. the injected Playwright report viewer) only knows
// what's in the URL. Returns null if no matching test_run exists.
function resolveTestRun(
  testId: string,
  reportId: string
): { fileId: string; project: string; errorSignature?: string } | null {
  const runs = testDb.getTestRunsByReport(reportId);
  const run = runs.find((r) => r.testId === testId);
  if (!run) return null;
  return {
    fileId: run.fileId,
    project: run.project,
    errorSignature: run.errorSignature ?? undefined,
  };
}

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/analytics', async (request, reply) => {
    try {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return authResult;

      const {
        project = 'all',
        from,
        to,
      } = request.query as {
        project?: string;
        from?: string;
        to?: string;
      };
      const analyticsData = await analyticsService.getAnalyticsData(project, from, to);

      return { success: true, data: analyticsData };
    } catch (error) {
      reply.status(500);
      return {
        success: false,
        error: `Failed to fetch analytics data: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  fastify.post('/api/llm/analyze-failed-test', async (request, reply) => {
    try {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return authResult;

      const { testId, reportId, prompt } = request.body as {
        testId: string;
        reportId: string;
        prompt: string;
      };

      if (!testId || !reportId || !prompt) {
        reply.status(400);
        reply.send({
          success: false,
          error: 'Missing some of required parameters: testId, reportId, prompt',
        });
        return;
      }

      if (!llmService.isConfigured()) {
        reply.status(400);
        reply.send({
          success: false,
          error: 'LLM service is not enabled. Set LLM_BASE_URL and LLM_API_TOKEN to enable',
        });
        return;
      }

      const { error: llmInitError } = await withError(llmService.initialize());
      if (llmInitError) {
        reply.status(400);
        reply.send({
          success: false,
          error: `LLM initialization error: ${llmInitError instanceof Error ? llmInitError.message : 'Unknown initialization error'}`,
        });
        return;
      }

      const task = llmTasksDb.createTask('test_analysis', {
        reportId,
        testId,
        project: 'default',
      });
      // Skip the queue's poll cycle and mark this task processing right away.
      const now = new Date().toISOString();
      try {
        const db = (await import('../lib/service/db/db.js')).getDatabase();
        db.prepare('UPDATE llm_tasks SET status = ?, startedAt = ?, prompt = ? WHERE id = ?').run(
          'processing',
          now,
          prompt.substring(0, 2000),
          task.id
        );
      } catch {
        // Task tracking is non-critical — never block the analysis on it.
      }

      const { result: trends, error: testHistoryError } = await withError(
        analyticsService.getTestTrends(testId)
      );

      if (testHistoryError) {
        console.warn(
          `[llm] Failed to fetch historical data: ${testHistoryError instanceof Error ? testHistoryError.message : String(testHistoryError)}`
        );
      }

      const context: any = {};
      if (trends && trends.runs.length > 0) {
        const recentFailures = trends.runs.filter((run) => run.isOutlier).slice(-3).length;

        context.totalRuns = trends.runs.length;
        context.averageDuration = trends.statistics?.mean || 0;
        context.isFlaky =
          trends.runs.length > 5 && trends.statistics.stdDev > trends.statistics.mean * 0.3;
        context.recentFailures = recentFailures;
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const sendChunk = (chunk: {
        type: string;
        content?: string;
        model?: string;
        usage?: any;
        finishReason?: string;
        error?: string;
      }) => {
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      let fullContent = '';
      let modelName = '';
      try {
        await llmService.sendMessageStream(
          prompt,
          (chunk) => {
            sendChunk(chunk);
            if (chunk.type === 'token' && chunk.content) {
              fullContent += chunk.content;
            }
            if (chunk.type === 'done' && chunk.model) {
              modelName = chunk.model;
            }
          },
          {
            context,
          }
        );

        if (fullContent) {
          // LLM may wrap the structured {category, analysis} JSON in markdown code fences.
          let analysisText = fullContent;
          let parsedCategory: string | undefined;
          try {
            let jsonStr = fullContent.trim();
            const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
            if (fenceMatch) jsonStr = fenceMatch[1].trim();
            const parsed = JSON.parse(jsonStr);
            if (parsed.analysis) analysisText = parsed.analysis;
            if (parsed.category) parsedCategory = parsed.category;
          } catch {
            /* not JSON — use raw content */
          }

          // Combine LLM-parsed category with the heuristic baseline using the precedence
          // rule: LLM overrides only when its category is in the known enum AND either
          // the heuristic returned 'unknown' or the LLM agrees with it.
          const { detectFailureCategory, isKnownCategory } = await import(
            '../lib/service/testManagement.js'
          );
          const runs = testDb.getTestRunsByReport(reportId);
          const matchingRun = runs.find((r) => r.testId === testId);
          let heuristicCategory: string | undefined;
          if (matchingRun?.failureDetails) {
            try {
              const details = JSON.parse(matchingRun.failureDetails);
              heuristicCategory = detectFailureCategory(details.message || '');
            } catch {
              /* ignore parse errors */
            }
          }
          let detectedCategory: string | undefined = heuristicCategory;
          let categorySource: 'heuristic' | 'llm' = 'heuristic';
          if (
            parsedCategory &&
            isKnownCategory(parsedCategory) &&
            (heuristicCategory === 'unknown' || parsedCategory === heuristicCategory)
          ) {
            detectedCategory = parsedCategory;
            categorySource = 'llm';
          }

          llmTasksDb.complete(task.id, analysisText, detectedCategory, modelName || undefined);

          // Mirror to test_llm_analyses so checkForPrecomputedAnalysis can find it.
          try {
            const fileId = matchingRun?.fileId || '';
            const project = matchingRun?.project || 'default';
            if (fileId) {
              testAnalysisDb.upsert(
                testId,
                fileId,
                project,
                reportId,
                analysisText,
                detectedCategory,
                modelName || undefined
              );
            }
            if (matchingRun?.runId && detectedCategory) {
              testDb.updateFailureCategory(matchingRun.runId, detectedCategory, categorySource);
            }
          } catch (persistError) {
            // Non-critical: the analysis still lives in llm_tasks as a fallback.
            console.error('[llm] Failed to persist analysis to test_llm_analyses:', persistError);
          }
        } else {
          llmTasksDb.fail(task.id, 'LLM returned empty response');
        }
      } catch (streamError) {
        const errorMsg =
          streamError instanceof Error ? streamError.message : 'Stream error occurred';
        sendChunk({ type: 'error', error: errorMsg });
        llmTasksDb.fail(task.id, errorMsg);
      }

      reply.raw.end();
    } catch (error) {
      fastify.log.error({
        error: 'LLM streaming analysis error',
        message: error instanceof Error ? error.message : String(error),
      });
      if (!reply.sent) {
        reply.status(500);
        reply.send({ success: false, error: 'Failed to analyze test with LLM' });
      }
    }
  });

  // GET /api/report/:id/failure-summary - get stored failure summary for a report
  fastify.get(
    '/api/report/:id/failure-summary',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authResult = await authenticate(request as AuthRequest, reply);
        if (authResult) return authResult;

        const { id } = request.params as { id: string };
        const summary = failureSummaryDb.getSummary(id);

        // The UI uses `hasFailures` to decide whether to show the "Summarize" button.
        const runs = testDb.getTestRunsByReport(id);
        const hasFailures = runs.some(
          (r) => r.outcome === 'unexpected' || r.outcome === 'failed' || r.outcome === 'flaky'
        );

        return reply.send({ success: true, data: summary ?? null, hasFailures });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to fetch failure summary',
        });
      }
    }
  );

  // POST /api/report/:id/analyze - trigger analysis for a specific report
  fastify.post('/api/report/:id/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

    try {
      const { id } = request.params as { id: string };
      const testRuns = testDb.getTestRunsByReport(id);

      // Older reports may lack stored failure details, so fall back to the outcome itself.
      const failedRuns = testRuns.filter(
        (run) =>
          run.failureDetails ||
          run.outcome === 'unexpected' ||
          run.outcome === 'failed' ||
          run.outcome === 'flaky'
      );

      // A test can have multiple runs in one report — collapse them.
      const seen = new Set<string>();
      let queued = 0;
      let project: string | undefined;

      for (const run of failedRuns) {
        const key = `${run.testId}:${run.fileId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        project ??= run.project;

        llmTasksDb.createTask('test_analysis', {
          reportId: id,
          testId: run.testId,
          fileId: run.fileId,
          project: run.project,
        });
        queued++;
      }

      if (queued > 0) {
        llmTasksDb.createTask('report_summary', {
          reportId: id,
          project,
          priority: -1,
        });
        queued++;
      }

      return reply.send({ success: true, queued });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to trigger report analysis',
      });
    }
  });

  // GET /api/analytics/failure-categories - aggregate categories across reports
  fastify.get(
    '/api/analytics/failure-categories',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authResult = await authenticate(request as AuthRequest, reply);
        if (authResult) return authResult;

        const { project, from, to } = request.query as {
          project?: string;
          from?: string;
          to?: string;
        };

        const result = failureSummaryDb.getAggregatedCategories(project || undefined, 10, {
          from,
          to,
        });

        return reply.send({ success: true, data: result });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to fetch failure categories',
        });
      }
    }
  );

  // POST /api/analytics/failure-categories/llm - per-project LLM failure summary (SSE stream)
  fastify.post(
    '/api/analytics/failure-categories/llm',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authResult = await authenticate(request as AuthRequest, reply);
        if (authResult) return authResult;

        const { project, from, to } = request.query as {
          project?: string;
          from?: string;
          to?: string;
        };

        if (!llmService.isConfigured()) {
          return reply.status(400).send({
            success: false,
            error: 'LLM service is not configured',
          });
        }

        const { error: llmInitError } = await withError(llmService.initialize());
        if (llmInitError) {
          return reply.status(400).send({
            success: false,
            error: `LLM initialization error: ${llmInitError instanceof Error ? llmInitError.message : 'Unknown'}`,
          });
        }

        // Gather the latest N reports in the active window (or overall when unbounded).
        const allInWindow =
          from || to
            ? reportDb.getByProject(project || undefined, { from, to })
            : reportDb.getLatestByProject(project || undefined, 10);
        const latestReports = allInWindow.slice(0, 10);
        if (latestReports.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'No reports available for this project.',
          });
        }

        const hasAnyFailures = latestReports.some(
          (r) => r.stats && ((r.stats.unexpected ?? 0) > 0 || (r.stats.flaky ?? 0) > 0)
        );

        if (!hasAnyFailures) {
          // No failures → skip the LLM call and emit a short canned message.
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          const msg = `All ${latestReports.length} latest test runs passed without failures. Everything is looking good!`;
          reply.raw.write(`data: ${JSON.stringify({ type: 'token', content: msg })}\n\n`);
          reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          reply.raw.end();
          return;
        }

        const failureSummaryMap = new Map(
          failureSummaryDb
            .getSummariesByProject(project || undefined, 10, { from, to })
            .map((s) => [s.reportId, s])
        );

        const { projectFailureSummaryPrompt } = await import('../lib/llm/prompts/index.js');
        const prompt = projectFailureSummaryPrompt(
          project || 'all',
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

        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const sendChunk = (chunk: {
          type: string;
          content?: string;
          model?: string;
          error?: string;
        }) => {
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        };

        try {
          await llmService.sendMessageStream(prompt, (chunk) => {
            sendChunk(chunk);
          });
        } catch (streamError) {
          sendChunk({
            type: 'error',
            error: streamError instanceof Error ? streamError.message : 'Stream error',
          });
        }

        reply.raw.end();
      } catch (error) {
        fastify.log.error(error);
        if (!reply.sent) {
          reply.status(500).send({
            success: false,
            error: 'Failed to generate project failure summary',
          });
        }
      }
    }
  );

  // Resolve fileId+project for a test from (testId, reportId) when the caller — typically
  // the injected Playwright panel — only knows what's in the URL.
  const resolveTestKeys = async (
    testId: string,
    fileId: string | undefined,
    project: string | undefined,
    reportId: string | undefined
  ): Promise<
    | { ok: true; fileId: string; project: string; signature?: string }
    | { ok: false; status: number; error: string }
  > => {
    let fId = fileId;
    let proj = project;
    let signature: string | undefined;
    if ((!fId || !proj) && reportId) {
      const resolved = resolveTestRun(testId, reportId);
      if (!resolved) {
        return { ok: false, status: 404, error: 'No test_run found for testId+reportId' };
      }
      fId = fId ?? resolved.fileId;
      proj = proj ?? resolved.project;
      signature = resolved.errorSignature;
    }
    if (!fId || !proj) {
      return {
        ok: false,
        status: 400,
        error: 'feedback requires fileId+project or reportId',
      };
    }
    return { ok: true, fileId: fId, project: proj, signature };
  };

  // GET /api/llm/feedback - get the single note for a test
  fastify.get('/api/llm/feedback', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

    const parsed = GetFeedbackQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message });
    }
    const q = parsed.data;
    const keys = await resolveTestKeys(q.testId, q.fileId, q.project, q.reportId);
    if (!keys.ok) return reply.status(keys.status).send({ success: false, error: keys.error });

    return reply.send({
      success: true,
      data: feedbackRowToShared(analysisFeedbackDb.getByTest(q.testId, keys.fileId, keys.project)),
    });
  });

  // PUT /api/llm/feedback - upsert (creates on first call, edits comment thereafter)
  fastify.put('/api/llm/feedback', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

    const parsed = UpsertFeedbackRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message });
    }
    const body = parsed.data;
    const keys = await resolveTestKeys(body.testId, body.fileId, body.project, body.reportId);
    if (!keys.ok) return reply.status(keys.status).send({ success: false, error: keys.error });

    // On first create, persist provenance (originReportId + errorSignature). Edits never touch them.
    const existing = analysisFeedbackDb.getByTest(body.testId, keys.fileId, keys.project);
    let errorSignature: string | undefined;
    let originReportId: string | undefined;
    if (!existing) {
      if (keys.signature !== undefined || body.reportId) {
        errorSignature = keys.signature;
        originReportId = body.reportId;
      } else {
        // Fallback when only fileId+project provided: pick most recent run for signature.
        const runs = testDb.getTestRuns(body.testId, keys.fileId, keys.project);
        const sourceRun = runs[0];
        errorSignature = sourceRun?.errorSignature;
        originReportId = sourceRun?.reportId;
      }
    }

    const row = analysisFeedbackDb.upsertTest({
      testId: body.testId,
      fileId: keys.fileId,
      project: keys.project,
      comment: body.comment,
      originReportId,
      errorSignature,
    });
    return reply.send({ success: true, data: feedbackRowToShared(row) });
  });

  // DELETE /api/llm/feedback - clear the note for a test
  fastify.delete('/api/llm/feedback', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

    const parsed = DeleteFeedbackRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message });
    }
    const body = parsed.data;
    const keys = await resolveTestKeys(body.testId, body.fileId, body.project, body.reportId);
    if (!keys.ok) return reply.status(keys.status).send({ success: false, error: keys.error });

    analysisFeedbackDb.deleteByTest(body.testId, keys.fileId, keys.project);
    return reply.send({ success: true });
  });

  // POST /api/llm/regenerate - enqueue a new test_analysis attempt (dedups in-flight tasks).
  // cascadeReportSummary=true also enqueues a report_summary task for the request's reportId.
  fastify.post('/api/llm/regenerate', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

    const parsed = FeedbackRegenerateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message });
    }
    const body = parsed.data;
    const keys = await resolveTestKeys(body.testId, body.fileId, body.project, body.reportId);
    if (!keys.ok) return reply.status(keys.status).send({ success: false, error: keys.error });

    const db = getDatabase();

    const inflightTest = db
      .prepare(
        `SELECT id FROM llm_tasks
         WHERE type = 'test_analysis'
           AND testId = ? AND fileId = ? AND project = ? AND reportId = ?
           AND status IN ('queued','processing')
         LIMIT 1`
      )
      .get(body.testId, keys.fileId, keys.project, body.reportId ?? '') as
      | { id: string }
      | undefined;

    let taskId: string;
    let deduped: boolean;
    if (inflightTest) {
      taskId = inflightTest.id;
      deduped = true;
    } else {
      const created = llmTasksDb.createTask('test_analysis', {
        reportId: body.reportId,
        testId: body.testId,
        fileId: keys.fileId,
        project: keys.project,
      });
      taskId = created.id;
      deduped = false;
    }

    let cascadedReportTaskId: string | undefined;
    if (body.cascadeReportSummary && body.reportId) {
      const inflightReport = db
        .prepare(
          `SELECT id FROM llm_tasks
           WHERE type = 'report_summary' AND reportId = ?
             AND status IN ('queued','processing')
           LIMIT 1`
        )
        .get(body.reportId) as { id: string } | undefined;
      if (inflightReport) {
        cascadedReportTaskId = inflightReport.id;
      } else {
        const reportTask = llmTasksDb.createTask('report_summary', {
          reportId: body.reportId,
          project: keys.project,
        });
        cascadedReportTaskId = reportTask.id;
      }
    }

    return reply.send({
      success: true,
      data: { taskId, deduped, cascadedReportTaskId },
    });
  });

  // GET /api/llm/feedback/related - Phase 2: same-test feedback in other projects.
  // Accepts (testId+fileId+excludeProject) for the React UI, or (testId+reportId) for the
  // injected Playwright panel — server resolves fileId+project from test_runs in the latter.
  fastify.get('/api/llm/feedback/related', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

    const parsed = GetRelatedFeedbackQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message });
    }
    const q = parsed.data;

    let fileId = q.fileId;
    let excludeProject = q.excludeProject;
    let currentSignature: string | undefined;
    if ((!fileId || !excludeProject) && q.reportId) {
      const resolved = resolveTestRun(q.testId, q.reportId);
      if (!resolved) {
        return reply
          .status(404)
          .send({ success: false, error: 'No test_run found for testId+reportId' });
      }
      fileId = fileId ?? resolved.fileId;
      excludeProject = excludeProject ?? resolved.project;
      currentSignature = resolved.errorSignature;
    }
    if (!fileId || !excludeProject) {
      return reply.status(400).send({
        success: false,
        error: '/related requires (fileId + excludeProject) or reportId',
      });
    }

    const rows = analysisFeedbackDb.getRelatedByTest(q.testId, fileId, excludeProject);

    const entries = rows.map((r) => ({
      project: r.project,
      feedback: {
        id: r.id,
        testId: r.testId ?? undefined,
        fileId: r.fileId ?? undefined,
        project: r.project,
        reportId: r.reportId ?? undefined,
        errorSignature: r.errorSignature ?? undefined,
        comment: r.comment,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
      latestAnalysis: r.latestAnalysis
        ? {
            analysis: r.latestAnalysis,
            updatedAt: r.latestAnalysisUpdatedAt ?? r.updatedAt,
            model: r.latestAnalysisModel ?? undefined,
          }
        : undefined,
      errorSignatureMatchesCurrent:
        !!currentSignature && !!r.errorSignature && r.errorSignature === currentSignature,
    }));

    return reply.send({ success: true, data: entries });
  });

  // GET /api/llm/test-history - Phase 2: failure-occurrence history for a test by errorSignature.
  // Same identity rules as /related: (testId+fileId+project+errorSignature) or (testId+reportId).
  fastify.get('/api/llm/test-history', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

    const { testId, reportId, fileId, project, errorSignature } = request.query as {
      testId?: string;
      reportId?: string;
      fileId?: string;
      project?: string;
      errorSignature?: string;
    };
    if (!testId) {
      return reply.status(400).send({ success: false, error: 'testId is required' });
    }

    let resolvedFileId = fileId;
    let resolvedProject = project;
    let resolvedSignature = errorSignature;
    let excludeReportId = reportId ?? '';
    if ((!resolvedFileId || !resolvedProject || !resolvedSignature) && reportId) {
      const resolved = resolveTestRun(testId, reportId);
      if (!resolved) {
        return reply.send({
          success: true,
          data: { priorOccurrenceCount: 0, firstOccurrence: null },
        });
      }
      resolvedFileId = resolvedFileId ?? resolved.fileId;
      resolvedProject = resolvedProject ?? resolved.project;
      resolvedSignature = resolvedSignature ?? resolved.errorSignature;
    }
    if (!resolvedFileId || !resolvedProject || !resolvedSignature) {
      // No signature → cannot identify recurrence. Return empty history (treated as "new").
      return reply.send({
        success: true,
        data: { priorOccurrenceCount: 0, firstOccurrence: null },
      });
    }

    const history = testDb.getFailureHistory(
      testId,
      resolvedFileId,
      resolvedProject,
      resolvedSignature,
      excludeReportId
    );
    return reply.send({ success: true, data: history });
  });

}
