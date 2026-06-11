import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { llmService } from '../lib/llm/index.js';
import {
  DEFAULT_SYSTEM_PROMPT,
  PROJECT_SUMMARY_SYSTEM_PROMPT,
  PROJECT_SUMMARY_TASK_INSTRUCTIONS,
  REPORT_SUMMARY_TASK_INSTRUCTIONS,
  TEST_ANALYSIS_SYSTEM_PROMPT,
  TEST_ANALYSIS_TASK_INSTRUCTIONS,
} from '../lib/llm/prompts/index.js';
import { getDatabase } from '../lib/service/db/db.js';
import { failureSummaryDb } from '../lib/service/db/failureSummary.sqlite.js';
import type { LlmTaskRow, LlmTaskStatus, LlmTaskType } from '../lib/service/db/llmTasks.sqlite.js';
import { llmTasksDb } from '../lib/service/db/llmTasks.sqlite.js';
import { getUsageByModel, getUsageStats } from '../lib/service/db/queries/llmUsage.js';
import { testAnalysisDb } from '../lib/service/db/testAnalysis.sqlite.js';
import { testDb } from '../lib/service/db/tests.sqlite.js';
import { service } from '../lib/service/index.js';
import { llmTaskEvents } from '../lib/service/llmTaskEvents.js';
import { type AuthRequest, authenticate } from './auth.js';

const TERMINAL_STATUSES: ReadonlySet<LlmTaskStatus> = new Set(['completed', 'failed', 'cancelled']);

// Hard ceiling for bulk re-queue endpoints. Even a "queue everything missing"
// admin action shouldn't be allowed to insert tens of thousands of rows in a
// single request and starve concurrent traffic; the user can re-invoke after
// the first batch processes.
const BULK_REQUEUE_LIMIT = 5000;

/** In-memory cache for /api/llm/available-models. Avoids hammering the
 *  provider's /models endpoint when the user spam-clicks "Refresh". TTL is
 *  short enough that a model rename in the provider becomes visible quickly.
 *  Keyed by `llmService.getProviderKey()` so a config change (different
 *  provider/baseUrl/model) auto-invalidates without needing manual flushes. */
const AVAILABLE_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
let availableModelsCache: { key: string; models: string[]; expiresAt: number } | null = null;

const getFailedTestsWithoutAnalysis = () => testDb.getFailedTestsWithoutAnalysis();

export async function registerLlmRoutes(fastify: FastifyInstance) {
  // GET /api/llm/tasks - paginated task list with optional filters
  fastify.get('/api/llm/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const { status, type, reportId, model, limit, offset } = request.query as {
        status?: LlmTaskStatus;
        type?: LlmTaskType;
        reportId?: string;
        model?: string;
        limit?: string;
        offset?: string;
      };

      const rawLimit = limit ? Number.parseInt(limit, 10) : 50;
      const parsedLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 25;
      const rawOffset = offset ? Number.parseInt(offset, 10) : 0;
      const parsedOffset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

      const { data, total } = llmTasksDb.getTasksPaginated({
        status,
        type,
        reportId,
        model: model && model.length > 0 ? model : undefined,
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
      const windowFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      // Honour the manual reset timestamp so the user sees zero immediately
      // after clicking "Reset counters" on the queue page.
      const cfg = await service.getConfig();
      const fromDate =
        cfg.llmUsageResetAt && cfg.llmUsageResetAt > windowFrom ? cfg.llmUsageResetAt : windowFrom;

      const { totals, byType, reuse } = getUsageStats(fromDate);

      return {
        success: true,
        data: {
          days,
          fromDate,
          totals,
          byType,
          reuse: {
            analyses: reuse.analyses ?? 0,
            reused: reuse.reused ?? 0,
            rate: reuse.analyses && reuse.analyses > 0 ? (reuse.reused ?? 0) / reuse.analyses : 0,
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

  // GET /api/llm/usage-by-model?days=N - per-(baseUrl, model) breakdown of
  // completed-task spend over the last N days. Lazy-loaded from the queue
  // page's "Check by model" expandable section — kept separate from
  // /usage-stats so the always-visible card stays cheap and this query only
  // runs when the user opens the breakdown.
  fastify.get('/api/llm/usage-by-model', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const { days: daysRaw } = request.query as { days?: string };
      const parsed = daysRaw ? Number.parseInt(daysRaw, 10) : 7;
      const days = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : 7;
      const windowFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const cfg = await service.getConfig();
      const fromDate =
        cfg.llmUsageResetAt && cfg.llmUsageResetAt > windowFrom ? cfg.llmUsageResetAt : windowFrom;

      const rows = getUsageByModel(fromDate);

      return {
        success: true,
        data: { days, fromDate, rows },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch LLM usage-by-model breakdown',
      });
    }
  });

  // POST /api/llm/usage/reset - mark the current moment as the new zero
  // baseline for the usage card. Subsequent /usage-stats and /usage-by-model
  // queries clamp their lower bound to this timestamp, so the counters read
  // as zero until new completed tasks land.
  fastify.post('/api/llm/usage/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const next = await service.updateConfig({ llmUsageResetAt: new Date().toISOString() });
      return { success: true, llmUsageResetAt: next.llmUsageResetAt };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ success: false, error: 'Failed to reset usage counters' });
    }
  });

  fastify.get('/api/llm/tasks/models', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    try {
      const models = llmTasksDb.getDistinctModels();
      return { success: true, models };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch LLM task models',
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
        const batch = rows.slice(0, BULK_REQUEUE_LIMIT);
        const queued = llmTasksDb.bulkCreateTestAnalysis(batch);
        const remaining = Math.max(0, rows.length - queued);

        return { success: true, queued, remaining };
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
      const initialRow = llmTasksDb.getById(taskId);
      if (!initialRow) {
        return reply.status(404).send({ success: false, error: 'Task not found' });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const eventName = `task:${taskId}`;
      let closed = false;
      let keepalive: NodeJS.Timeout | undefined;

      const onUpdate = (row: LlmTaskRow) => {
        const ok = send('update', row);
        if (ok && TERMINAL_STATUSES.has(row.status)) {
          cleanup();
          reply.raw.end();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepalive) clearInterval(keepalive);
        llmTaskEvents.off(eventName, onUpdate);
      };

      const send = (event: string, data: unknown): boolean => {
        if (closed) return false;
        try {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          return true;
        } catch (err) {
          fastify.log.warn({ err, taskId }, 'SSE write failed; closing stream');
          cleanup();
          try {
            reply.raw.end();
          } catch {
            // socket already destroyed
          }
          return false;
        }
      };

      // Emit initial state immediately so a late-subscribed client doesn't
      // miss a status that already settled before the SSE handshake completed.
      const initialOk = send('update', initialRow);
      if (!initialOk) return;
      if (TERMINAL_STATUSES.has(initialRow.status)) {
        reply.raw.end();
        return;
      }

      // Keep the connection alive across NAT/proxy idle timeouts.
      keepalive = setInterval(() => {
        if (closed) return;
        try {
          reply.raw.write(': keepalive\n\n');
        } catch {
          cleanup();
        }
      }, 30_000);

      llmTaskEvents.on(eventName, onUpdate);
      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);
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
        projectSummarySystemPrompt: {
          content: PROJECT_SUMMARY_SYSTEM_PROMPT,
          vars: [],
        },
        testAnalysisInstructions: {
          content: TEST_ANALYSIS_TASK_INSTRUCTIONS,
          vars: ['project', 'testTitle', 'filePath'],
        },
        // Combined override for the report-summary task. The system message
        // is built-in and not user-overridable; this slot covers the entire
        // user-facing instruction template.
        reportSummaryPrompt: {
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
      const tx = getDatabase().transaction(() => {
        testAnalysisDb.deleteAll();
        failureSummaryDb.deleteAll();
      });
      tx();

      const rows = getFailedTestsWithoutAnalysis();
      const batch = rows.slice(0, BULK_REQUEUE_LIMIT);
      const queued = llmTasksDb.bulkCreateTestAnalysis(batch);
      const remaining = Math.max(0, rows.length - queued);

      return { success: true, queued, remaining };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to rerun all analyses',
      });
    }
  });
}
