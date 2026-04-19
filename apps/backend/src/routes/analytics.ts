import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { llmService } from '../lib/llm/index.js';
import { analyticsService } from '../lib/service/analytics.js';
import { failureSummaryDb } from '../lib/service/db/failureSummary.sqlite.js';
import { llmTasksDb } from '../lib/service/db/llmTasks.sqlite.js';
import { testDb } from '../lib/service/db/tests.sqlite.js';
import { withError } from '../lib/withError.js';
import { authenticate, type AuthRequest } from './auth.js';

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/analytics', async (request, reply) => {
    try {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return authResult;

      const { project = 'all' } = request.query as { project?: string };
      const analyticsData = await analyticsService.getAnalyticsData(project);

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

      // Track in LLM task queue
      const task = llmTasksDb.createTask('test_analysis', {
        reportId,
        testId,
        project: 'default',
      });
      // Mark as processing immediately (bypassing queue polling)
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
        // Non-critical — task tracking failure shouldn't block the analysis
      }

      console.log(`[llm] Fetching historical data for testId: ${testId}, reportId: ${reportId}`);
      const { result: trends, error: testHistoryError } = await withError(
        analyticsService.getTestTrends(testId)
      );

      if (testHistoryError) {
        console.log(
          `[llm] Failed to fetch historical data: ${testHistoryError instanceof Error ? testHistoryError.message : String(testHistoryError)}`
        );
      }

      console.log(
        `[llm] Historical data result:`,
        trends ? `Found ${trends?.runs?.length} runs` : 'No historical data found'
      );

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
        await llmService.sendMessageStream(prompt, (chunk) => {
          sendChunk(chunk);
          if (chunk.type === 'token' && chunk.content) {
            fullContent += chunk.content;
          }
          if (chunk.type === 'done' && chunk.model) {
            modelName = chunk.model;
          }
        }, {
          context,
        });

        // Mark task as completed in the queue
        if (fullContent) {
          llmTasksDb.complete(task.id, fullContent, undefined, modelName || undefined);
        } else {
          llmTasksDb.fail(task.id, 'LLM returned empty response');
        }
      } catch (streamError) {
        const errorMsg = streamError instanceof Error ? streamError.message : 'Stream error occurred';
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

        // Check if report has any failures (for UI to decide whether to show "Summarize" button)
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
  fastify.post(
    '/api/report/:id/analyze',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return authResult;

      try {
        const { id } = request.params as { id: string };
        const testRuns = testDb.getTestRunsByReport(id);

        // Include runs with failure details OR failed outcomes (for older reports without stored details)
        const failedRuns = testRuns.filter(
          (run) =>
            run.failureDetails ||
            run.outcome === 'unexpected' ||
            run.outcome === 'failed' ||
            run.outcome === 'flaky'
        );

        // Deduplicate by testId+fileId (a test may have multiple runs in the report)
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

        // Also create a report summary task if there are failed tests
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
    }
  );

  // GET /api/analytics/failure-categories - aggregate categories across reports
  fastify.get(
    '/api/analytics/failure-categories',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authResult = await authenticate(request as AuthRequest, reply);
        if (authResult) return authResult;

        const { project } = request.query as { project?: string };

        const result = failureSummaryDb.getAggregatedCategories(project || undefined, 10);

        // If topErrors is empty, build from test_llm_analyses
        if (result.topErrors.length === 0 && result.totalFailures > 0) {
          const db = (await import('../lib/service/db/db.js')).getDatabase();
          const rows = db.prepare(`
            SELECT analysis, category, testId, reportId
            FROM test_llm_analyses
            WHERE analysis IS NOT NULL
            ORDER BY updatedAt DESC
            LIMIT 20
          `).all() as Array<{ analysis: string; category: string; testId: string; reportId: string }>;

          const errorMap = new Map<string, { message: string; category: string; count: number; signature: string }>();
          for (const row of rows) {
            const cat = row.category || 'unknown';
            const existing = errorMap.get(cat);
            if (existing) {
              existing.count++;
            } else {
              errorMap.set(cat, {
                message: (row.analysis || '').substring(0, 200),
                category: cat,
                count: 1,
                signature: cat,
              });
            }
          }
          result.topErrors = Array.from(errorMap.values()).sort((a, b) => b.count - a.count);
        }

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

        const { project } = request.query as { project?: string };

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

        // Gather report summaries for the project
        const summaries = failureSummaryDb.getSummariesByProject(project || undefined, 10);
        if (summaries.length === 0) {
          return reply.status(400).send({
            success: false,
            error: 'No report summaries available. Run analysis on reports first.',
          });
        }

        const { projectFailureSummaryPrompt } = await import('../lib/llm/prompts/index.js');
        const prompt = projectFailureSummaryPrompt(
          project || 'all',
          summaries.map((s) => ({
            reportId: s.reportId,
            totalFailures: s.totalFailures,
            categories: s.categories,
            llmSummary: s.llmSummary ?? undefined,
            createdAt: s.createdAt,
          }))
        );

        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const sendChunk = (chunk: { type: string; content?: string; model?: string; error?: string }) => {
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
}
