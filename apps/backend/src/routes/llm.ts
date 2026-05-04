import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { llmService } from '../lib/llm/index.js';
import { getDatabase } from '../lib/service/db/db.js';
import type { LlmTaskStatus, LlmTaskType } from '../lib/service/db/llmTasks.sqlite.js';
import { llmTasksDb } from '../lib/service/db/llmTasks.sqlite.js';
import { type AuthRequest, authenticate } from './auth.js';

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
    if (authResult) return authResult;

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

  // GET /api/llm/tasks/stats - task queue statistics
  fastify.get('/api/llm/tasks/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

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
    if (authResult) return authResult;

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
    if (authResult) return authResult;

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
    if (authResult) return authResult;

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
      if (authResult) return authResult;

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
    if (authResult) return authResult;

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
      if (authResult) return authResult;

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

  // POST /api/llm/test-connection - validate the LLM config without mutating the active
  // provider. Optional body lets the Settings UI test draft (unsaved) values.
  fastify.post('/api/llm/test-connection', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return authResult;

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
    if (authResult) return authResult;

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
