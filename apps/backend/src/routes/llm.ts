import type { LlmDefaultPrompts, LlmUsageByModel, LlmUsageStats } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  PROJECT_SUMMARY_SYSTEM_PROMPT,
  PROJECT_SUMMARY_TASK_INSTRUCTIONS,
  REPORT_SUMMARY_TASK_INSTRUCTIONS,
  TEST_ANALYSIS_SYSTEM_PROMPT,
  TEST_ANALYSIS_TASK_INSTRUCTIONS,
} from '../lib/llm/prompts/index.js';
import {
  DEFAULT_CRITIQUE_DIRECTIVE,
  DEFAULT_JUDGE_DIRECTIVE,
  DEFAULT_REVISE_DIRECTIVE,
  DEFAULT_SCORER_DIRECTIVE,
  DEFAULT_SYNTHESIZER_DIRECTIVE,
} from '../lib/llm/prompts/routing.js';
import { isLlmFeatureEnabled } from '../lib/llm/registry.js';
import { DEFAULT_SCREENSHOT_PARSE_PROMPT } from '../lib/llm/visionTranscribe.js';
import {
  failureSummaryDb,
  getDatabase,
  getUsageByModel,
  getUsageStats,
  type LlmTaskRow,
  type LlmTaskStatus,
  type LlmTaskType,
  llmTasksDb,
  testAnalysisDb,
  testAnalyticsDb,
} from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { llmTaskEvents } from '../lib/service/llmTaskEvents.js';
import { type AuthRequest, authenticate } from './auth.js';

const TERMINAL_STATUSES: ReadonlySet<LlmTaskStatus> = new Set(['completed', 'failed', 'cancelled']);

const BULK_REQUEUE_LIMIT = 5000;

const getFailedTestsWithoutAnalysis = () => testAnalyticsDb.getFailedTestsWithoutAnalysis();

export async function registerLlmRoutes(fastify: FastifyInstance) {
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

  fastify.get('/api/llm/usage-stats', async (request: FastifyRequest, reply: FastifyReply) => {
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

      const { totals, byType, reuse } = getUsageStats(fromDate);

      const data: LlmUsageStats = {
        days,
        fromDate,
        totals,
        byType,
        reuse: {
          analyses: reuse.analyses ?? 0,
          reused: reuse.reused ?? 0,
          rate: reuse.analyses && reuse.analyses > 0 ? (reuse.reused ?? 0) / reuse.analyses : 0,
        },
      };

      return { success: true, data };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch LLM usage stats',
      });
    }
  });

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

      const data: LlmUsageByModel = { days, fromDate, rows };

      return { success: true, data };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch LLM usage-by-model breakdown',
      });
    }
  });

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

  fastify.get<{ Params: { id: string } }>(
    '/api/llm/tasks/:id/roles',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;
      try {
        const rows = llmTasksDb.getRoleChildren(request.params.id);
        return { success: true, data: rows };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to fetch task roles' });
      }
    }
  );

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

  fastify.post(
    '/api/llm/generate-existing',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;
      if (!isLlmFeatureEnabled()) {
        return reply.status(403).send({ success: false, error: 'LLM features are disabled' });
      }

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

      const initialOk = send('update', initialRow);
      if (!initialOk) return;
      if (TERMINAL_STATUSES.has(initialRow.status)) {
        reply.raw.end();
        return;
      }

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

  fastify.get('/api/llm/default-prompts', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const data: LlmDefaultPrompts = {
      systemPrompt: {
        content: TEST_ANALYSIS_SYSTEM_PROMPT,
        vars: [],
      },
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
      reportSummaryPrompt: {
        content: REPORT_SUMMARY_TASK_INSTRUCTIONS,
        vars: ['reportId', 'project', 'totalFailures'],
      },
      projectSummaryInstructions: {
        content: PROJECT_SUMMARY_TASK_INSTRUCTIONS,
        vars: ['project', 'totalRuns', 'passingRuns'],
      },
      synthesizerDirective: { content: DEFAULT_SYNTHESIZER_DIRECTIVE, vars: [] },
      judgeDirective: { content: DEFAULT_JUDGE_DIRECTIVE, vars: [] },
      critiqueDirective: { content: DEFAULT_CRITIQUE_DIRECTIVE, vars: [] },
      reviseDirective: { content: DEFAULT_REVISE_DIRECTIVE, vars: [] },
      scorerDirective: { content: DEFAULT_SCORER_DIRECTIVE, vars: [] },
      screenshotParsePrompt: { content: DEFAULT_SCREENSHOT_PARSE_PROMPT, vars: [] },
    };

    return { success: true, data };
  });

  fastify.post('/api/llm/rerun-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;
    if (!isLlmFeatureEnabled()) {
      return reply.status(403).send({ success: false, error: 'LLM features are disabled' });
    }

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
