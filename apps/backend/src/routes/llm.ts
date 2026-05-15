import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { llmService } from '../lib/llm/index.js';
import {
  DEFAULT_SYSTEM_PROMPT,
  PROJECT_SUMMARY_SYSTEM_PROMPT,
  PROJECT_SUMMARY_TASK_INSTRUCTIONS,
  REPORT_SUMMARY_SYSTEM_PROMPT,
  REPORT_SUMMARY_TASK_INSTRUCTIONS,
  TEST_ANALYSIS_SYSTEM_PROMPT,
  TEST_ANALYSIS_TASK_INSTRUCTIONS,
} from '../lib/llm/prompts/index.js';
import { getDatabase } from '../lib/service/db/db.js';
import type { LlmTaskRow, LlmTaskStatus, LlmTaskType } from '../lib/service/db/llmTasks.sqlite.js';
import { llmTasksDb } from '../lib/service/db/llmTasks.sqlite.js';
import { llmTaskEvents } from '../lib/service/llmTaskEvents.js';
import { type AuthRequest, authenticate } from './auth.js';

const TERMINAL_STATUSES: ReadonlySet<LlmTaskStatus> = new Set(['completed', 'failed', 'cancelled']);

/** In-memory cache for /api/llm/available-models. Avoids hammering the
 *  provider's /models endpoint when the user spam-clicks "Refresh". TTL is
 *  short enough that a model rename in the provider becomes visible quickly.
 *  Keyed by `llmService.getProviderKey()` so a config change (different
 *  provider/baseUrl/model) auto-invalidates without needing manual flushes. */
const AVAILABLE_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
let availableModelsCache: { key: string; models: string[]; expiresAt: number } | null = null;

function getFailedTestsWithoutAnalysis() {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT DISTINCT t.testId, t.fileId, t.project, tr.reportId
       FROM test_runs tr
       JOIN tests t ON tr.testId = t.testId AND tr.fileId = t.fileId AND tr.project = t.project
       WHERE tr.failure_details IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM test_llm_analyses tla
         WHERE tla.testId = tr.testId AND tla.fileId = tr.fileId AND tla.project = tr.project
       )`
    )
    .all() as Array<{ testId: string; fileId: string; project: string; reportId: string }>;
}

export async function registerLlmRoutes(fastify: FastifyInstance) {
  // GET /api/llm/tasks - paginated task list with optional filters
  fastify.get('/api/llm/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const { status, type, reportId, limit, offset } = request.query as {
        status?: LlmTaskStatus;
        type?: LlmTaskType;
        reportId?: string;
        limit?: string;
        offset?: string;
      };

      const parsedLimit = limit ? Number.parseInt(limit, 10) : 25;
      const parsedOffset = offset ? Number.parseInt(offset, 10) : 0;

      const { data, total } = llmTasksDb.getTasksPaginated({
        status,
        type,
        reportId,
        limit: parsedLimit,
        offset: parsedOffset,
      });

      return { success: true, data, total };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch LLM tasks',
      });
    }
  });

  // GET /api/llm/usage-stats?days=N - aggregated token usage + reuse rate over
  // the last N days. Powers the dashboard card on the queue page.
  fastify.get('/api/llm/usage-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const { days: daysRaw } = request.query as { days?: string };
      const parsed = daysRaw ? Number.parseInt(daysRaw, 10) : 7;
      // Clamp to a sane range so a typo can't trigger a full-table scan.
      const days = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : 7;
      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const db = getDatabase();

      // Totals + byType across completed tasks. Filters on completedAt so
      // we measure when work actually settled, not when it was queued.
      const totalsRow = db
        .prepare(
          `SELECT
               COUNT(*) AS tasks,
               COALESCE(SUM(inputTokens), 0) AS inputTokens,
               COALESCE(SUM(outputTokens), 0) AS outputTokens,
               COALESCE(SUM(totalTokens), 0) AS totalTokens
             FROM llm_tasks
             WHERE status = 'completed' AND completedAt >= ?`
        )
        .get(fromDate) as {
        tasks: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };

      const byTypeRows = db
        .prepare(
          `SELECT
               type,
               COUNT(*) AS tasks,
               COALESCE(SUM(inputTokens), 0) AS inputTokens,
               COALESCE(SUM(outputTokens), 0) AS outputTokens,
               COALESCE(SUM(totalTokens), 0) AS totalTokens
             FROM llm_tasks
             WHERE status = 'completed' AND completedAt >= ?
             GROUP BY type`
        )
        .all(fromDate) as Array<{
        type: string;
        tasks: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      }>;

      const byType: Record<string, (typeof byTypeRows)[number]> = {};
      for (const row of byTypeRows) byType[row.type] = row;

      // Reuse rate: test_llm_analyses rows in the period, split on whether
      // they were copied from a prior signature match (reusedFromAnalysisId).
      const reuseRow = db
        .prepare(
          `SELECT
               COUNT(*) AS analyses,
               SUM(CASE WHEN reusedFromAnalysisId IS NOT NULL THEN 1 ELSE 0 END) AS reused
             FROM test_llm_analyses
             WHERE createdAt >= ?`
        )
        .get(fromDate) as { analyses: number; reused: number };

      return {
        success: true,
        data: {
          days,
          fromDate,
          totals: totalsRow,
          byType,
          reuse: {
            analyses: reuseRow.analyses ?? 0,
            reused: reuseRow.reused ?? 0,
            rate:
              reuseRow.analyses && reuseRow.analyses > 0
                ? (reuseRow.reused ?? 0) / reuseRow.analyses
                : 0,
          },
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch LLM usage stats',
      });
    }
  });

  // GET /api/llm/tasks/stats - task queue statistics
  fastify.get('/api/llm/tasks/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const stats = llmTasksDb.getStats();
      return { success: true, ...stats };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch LLM task stats',
      });
    }
  });

  // DELETE /api/llm/tasks - bulk delete tasks
  fastify.delete('/api/llm/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const { ids } = request.body as { ids: string[] };

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'ids array is required',
        });
      }

      llmTasksDb.bulkDelete(ids);
      return { success: true };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to delete LLM tasks',
      });
    }
  });

  // DELETE /api/llm/tasks/:id - delete a single task
  fastify.delete('/api/llm/tasks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const { id } = request.params as { id: string };
      llmTasksDb.bulkDelete([id]);
      return { success: true };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to delete LLM task',
      });
    }
  });

  // DELETE /api/llm/tasks/clear - clear queued + cancelled tasks
  fastify.delete('/api/llm/tasks/clear', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      llmTasksDb.clearQueue();
      return { success: true };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to clear LLM task queue',
      });
    }
  });

  // PATCH /api/llm/tasks/:id/cancel - cancel a specific task
  fastify.patch(
    '/api/llm/tasks/:id/cancel',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;

      try {
        const { id } = request.params as { id: string };
        llmTasksDb.cancel(id);
        return { success: true };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to cancel LLM task',
        });
      }
    }
  );

  // POST /api/llm/tasks/:id/retry - retry a failed task
  fastify.post('/api/llm/tasks/:id/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const { id } = request.params as { id: string };
      llmTasksDb.retry(id);
      return { success: true };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to retry LLM task',
      });
    }
  });

  // POST /api/llm/generate-existing - queue analysis for all failed tests without LLM analysis
  fastify.post(
    '/api/llm/generate-existing',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;

      try {
        const rows = getFailedTestsWithoutAnalysis();

        let queued = 0;
        for (const row of rows) {
          llmTasksDb.createTask('test_analysis', {
            reportId: row.reportId,
            testId: row.testId,
            fileId: row.fileId,
            project: row.project,
          });
          queued++;
        }

        return { success: true, queued };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to queue analysis for existing failures',
        });
      }
    }
  );

  // GET /api/llm/task-progress/:taskId - SSE stream of one task's status updates.
  // Emits an `update` event with the full row each time the task transitions.
  // Closes the connection when the task reaches a terminal status (completed,
  // failed, cancelled). Replaces 3s polling on the client.
  fastify.get(
    '/api/llm/task-progress/:taskId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;

      const { taskId } = request.params as { taskId: string };
      const db = getDatabase();
      const initialRow = db.prepare('SELECT * FROM llm_tasks WHERE id = ?').get(taskId) as
        | LlmTaskRow
        | undefined;
      if (!initialRow) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Emit initial state immediately so a late-subscribed client doesn't
      // miss a status that already settled before the SSE handshake completed.
      send('update', initialRow);
      if (TERMINAL_STATUSES.has(initialRow.status)) {
        reply.raw.end();
        return;
      }

      const eventName = `task:${taskId}`;
      const onUpdate = (row: LlmTaskRow) => {
        send('update', row);
        if (TERMINAL_STATUSES.has(row.status)) {
          cleanup();
          reply.raw.end();
        }
      };

      // Keep the connection alive across NAT/proxy idle timeouts.
      const keepalive = setInterval(() => {
        try {
          reply.raw.write(': keepalive\n\n');
        } catch {
          cleanup();
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(keepalive);
        llmTaskEvents.off(eventName, onUpdate);
      };

      llmTaskEvents.on(eventName, onUpdate);
      request.raw.on('close', cleanup);
    }
  );

  // GET /api/llm/default-prompts - returns the four built-in prompt templates plus
  // their per-template var allowlists. Powers the "View default" disclosure on
  // each Settings textarea so users can see what they're replacing and copy it
  // as a starting point. Static, doesn't touch the LLM provider.
  fastify.get('/api/llm/default-prompts', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    // The default `content` strings themselves embed {{var}} placeholders —
    // they're rendered through the same applyMustache path as user overrides.
    // So showing the default in the UI doubles as the canonical usage example.
    return {
      success: true,
      data: {
        // Legacy single-prompt field — kept for back-compat with older UIs
        // that haven't been updated to the per-task overrides below.
        systemPrompt: {
          content: DEFAULT_SYSTEM_PROMPT,
          vars: [],
        },
        // Per-task system prompts. The settings UI shows these alongside the
        // task instructions in Test/Report/Project groups so users can
        // override one task without touching the other two.
        testAnalysisSystemPrompt: {
          content: TEST_ANALYSIS_SYSTEM_PROMPT,
          vars: [],
        },
        reportSummarySystemPrompt: {
          content: REPORT_SUMMARY_SYSTEM_PROMPT,
          vars: [],
        },
        projectSummarySystemPrompt: {
          content: PROJECT_SUMMARY_SYSTEM_PROMPT,
          vars: [],
        },
        testAnalysisInstructions: {
          content: TEST_ANALYSIS_TASK_INSTRUCTIONS,
          vars: ['project', 'testTitle', 'filePath', 'errorCategory'],
        },
        reportSummaryInstructions: {
          content: REPORT_SUMMARY_TASK_INSTRUCTIONS,
          vars: ['reportId', 'project', 'totalFailures'],
        },
        projectSummaryInstructions: {
          content: PROJECT_SUMMARY_TASK_INSTRUCTIONS,
          vars: ['project', 'totalRuns', 'passingRuns'],
        },
      },
    };
  });

  // GET /api/llm/available-models - list models the active provider exposes via /models.
  // Powered by a 5-min cache to avoid hammering the provider on UI refresh clicks.
  // Pass ?refresh=1 to bypass the cache.
  fastify.get('/api/llm/available-models', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      if (!llmService.isConfigured()) {
        return reply.status(400).send({ success: false, error: 'LLM service is not configured' });
      }

      const { refresh } = request.query as { refresh?: string };
      const now = Date.now();
      const currentKey = llmService.getProviderKey();
      if (
        !refresh &&
        availableModelsCache &&
        availableModelsCache.key === currentKey &&
        availableModelsCache.expiresAt > now
      ) {
        return { success: true, models: availableModelsCache.models, cached: true };
      }

      await llmService.initialize();
      const models = await llmService.getAvailableModels();
      availableModelsCache = {
        key: currentKey,
        models,
        expiresAt: now + AVAILABLE_MODELS_CACHE_TTL_MS,
      };

      return { success: true, models, cached: false };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch available models',
      });
    }
  });

  // POST /api/llm/test-connection - validate the LLM config without mutating the active
  // provider. Optional body lets the Settings UI test draft (unsaved) values.
  fastify.post('/api/llm/test-connection', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const body = (request.body ?? {}) as {
      provider?: 'openai' | 'anthropic';
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      temperature?: number;
    };

    const result = await llmService.testConnection({
      provider: body.provider,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      model: body.model,
      temperature: body.temperature,
    });

    return reply.send(result);
  });

  // POST /api/llm/rerun-all - delete all analyses and re-queue
  fastify.post('/api/llm/rerun-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const db = getDatabase();

      // Clear existing analyses and summaries
      db.prepare('DELETE FROM test_llm_analyses').run();
      db.prepare('DELETE FROM report_failure_summaries').run();

      // Re-queue all failed tests
      const rows = getFailedTestsWithoutAnalysis();

      let queued = 0;
      for (const row of rows) {
        llmTasksDb.createTask('test_analysis', {
          reportId: row.reportId,
          testId: row.testId,
          fileId: row.fileId,
          project: row.project,
        });
        queued++;
      }

      return { success: true, queued };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to rerun all analyses',
      });
    }
  });
}
