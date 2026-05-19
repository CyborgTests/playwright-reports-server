import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDatabase } from '../lib/service/db/db.js';
import { testAnalysisDb } from '../lib/service/db/testAnalysis.sqlite.js';
import { testManagementService } from '../lib/service/testManagement.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

export async function registerTestsRoutes(fastify: FastifyInstance) {
  await fastify.register(async (fastify) => {
    fastify.addHook('preHandler', (request, reply) => authenticate(request as AuthRequest, reply));

    fastify.get('/api/tests', async (request: FastifyRequest, reply: FastifyReply) => {
      const { project, status, flakinessMin, flakinessMax, limit, offset, from, to, search } =
        request.query as {
          project?: string;
          status?: string;
          flakinessMin?: string;
          flakinessMax?: string;
          limit?: string;
          offset?: string;
          from?: string;
          to?: string;
          search?: string;
        };

      try {
        const options = {
          status: status as 'all' | 'quarantined' | 'not-quarantined' | undefined,
          flakinessMin: flakinessMin ? Number.parseInt(flakinessMin, 10) : undefined,
          flakinessMax: flakinessMax ? Number.parseInt(flakinessMax, 10) : undefined,
          limit: limit ? Number.parseInt(limit, 10) : undefined,
          offset: offset ? Number.parseInt(offset, 10) : undefined,
          from,
          to,
          search,
        };

        const { data, total } = await testManagementService.getTests(project, options);
        return reply.send({ success: true, data, total });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to fetch tests',
        });
      }
    });

    fastify.get(
      '/api/test/:fileId/:testId',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { fileId, testId } = request.params as { fileId: string; testId: string };
        const { project } = request.query as { project: string };

        const { result: test, error } = await withError(
          testManagementService.getTest(testId, fileId, project)
        );

        if (error) {
          fastify.log.error(error);
          return reply.status(500).send({
            success: false,
            error: 'Failed to fetch test details',
          });
        }

        if (!test) {
          return reply.status(404).send({
            success: false,
            error: 'Test not found',
          });
        }

        return reply.send({ success: true, data: test });
      }
    );

    fastify.delete(
      '/api/test/:fileId/:testId',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { fileId, testId } = request.params as { fileId: string; testId: string };
        const { project } = request.query as { project: string };

        if (!project) {
          return reply
            .status(400)
            .send({ success: false, error: 'project query parameter is required' });
        }

        const { error } = await withError(
          testManagementService.deleteTest(testId, fileId, project)
        );

        if (error) {
          fastify.log.error(error);
          return reply.status(500).send({ success: false, error: 'Failed to delete test' });
        }

        return reply.send({ success: true });
      }
    );

    fastify.patch(
      '/api/test/:fileId/:testId',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { fileId, testId } = request.params as { fileId: string; testId: string };
        const { project } = request.query as { project: string };
        const body = request.body as {
          isQuarantined: boolean;
          reason?: string;
        };

        if (body.isQuarantined && (!body.reason || body.reason.trim().length === 0)) {
          return reply.status(400).send({
            success: false,
            error: 'Reason is required when quarantining a test',
          });
        }

        if (body.reason && body.reason.length > 500) {
          return reply.status(400).send({
            success: false,
            error: 'Reason must be less than 500 characters',
          });
        }

        const { error } = await withError(
          testManagementService.updateQuarantineStatus(
            testId,
            fileId,
            project,
            body.isQuarantined,
            body.reason
          )
        );

        if (error) {
          fastify.log.error(error);
          return reply.status(500).send({
            success: false,
            error: 'Failed to update quarantine status',
          });
        }

        return reply.send({
          success: true,
          data: {
            testId,
            fileId,
            isQuarantined: body.isQuarantined,
            reason: body.reason,
          },
        });
      }
    );

    // GET /api/test/:fileId/:testId/analysis - get pre-computed LLM analysis for a test
    fastify.get(
      '/api/test/:fileId/:testId/analysis',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { fileId, testId } = request.params as { fileId: string; testId: string };
        const { project } = request.query as { project: string };

        if (!project) {
          return reply
            .status(400)
            .send({ success: false, error: 'project query parameter is required' });
        }

        try {
          const analysis = testAnalysisDb.getByTest(testId, fileId, project);

          return reply.send({ success: true, data: analysis ?? null });
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({
            success: false,
            error: 'Failed to fetch test analysis',
          });
        }
      }
    );

    // GET /api/test-analysis/:testId - get LLM analysis for a test run (used by Playwright report viewer)
    fastify.get(
      '/api/test-analysis/:testId',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { reportId } = request.query as { reportId?: string };

        try {
          const db = getDatabase();

          // retry takes precedence over the stored row: while a
          // retry-flagged task for this (testId, reportId) is still in flight,
          // surface it as pending so the viewer renders "regenerating…" instead
          // of the about-to-be-replaced analysis. Auto-queued (isRetry=0) tasks
          // do NOT preempt — those run as background fill-in and shouldn't hide
          // an existing analysis from the user.
          const retryPendingQuery = reportId
            ? db.prepare(
                `SELECT id, status FROM llm_tasks
               WHERE type = 'test_analysis' AND testId = ? AND reportId = ?
                 AND status IN ('queued','processing') AND isRetry = 1
               ORDER BY createdAt DESC LIMIT 1`
              )
            : db.prepare(
                `SELECT id, status FROM llm_tasks
               WHERE type = 'test_analysis' AND testId = ?
                 AND status IN ('queued','processing') AND isRetry = 1
               ORDER BY createdAt DESC LIMIT 1`
              );
          const retryPending = (
            reportId ? retryPendingQuery.get(testId, reportId) : retryPendingQuery.get(testId)
          ) as { id: string; status: string } | undefined;

          if (retryPending) {
            return reply.send({
              success: true,
              data: null,
              pending: { taskId: retryPending.id, status: retryPending.status },
            });
          }

          const analysis = reportId
            ? testAnalysisDb.getByTestAndReport(testId, reportId)
            : testAnalysisDb.getByTestAndReport(testId, '');

          if (analysis) {
            return reply.send({ success: true, data: analysis });
          }

          // Fall back to llm_tasks table — the SSE endpoint saves results there
          const taskQuery = reportId
            ? db.prepare(
                `SELECT result AS analysis, model, category FROM llm_tasks WHERE testId = ? AND reportId = ? AND status = 'completed' AND result IS NOT NULL ORDER BY completedAt DESC LIMIT 1`
              )
            : db.prepare(
                `SELECT result AS analysis, model, category FROM llm_tasks WHERE testId = ? AND status = 'completed' AND result IS NOT NULL ORDER BY completedAt DESC LIMIT 1`
              );

          const taskRow = reportId ? taskQuery.get(testId, reportId) : taskQuery.get(testId);

          if (taskRow) {
            return reply.send({ success: true, data: taskRow });
          }

          // No completed analysis yet — surface in-flight tasks so the report viewer
          // can render a loading state instead of nothing while the queue catches up.
          const pendingQuery = reportId
            ? db.prepare(
                `SELECT id, status FROM llm_tasks
               WHERE type = 'test_analysis' AND testId = ? AND reportId = ?
                 AND status IN ('queued','processing')
               ORDER BY createdAt DESC LIMIT 1`
              )
            : db.prepare(
                `SELECT id, status FROM llm_tasks
               WHERE type = 'test_analysis' AND testId = ?
                 AND status IN ('queued','processing')
               ORDER BY createdAt DESC LIMIT 1`
              );

          const pending = (
            reportId ? pendingQuery.get(testId, reportId) : pendingQuery.get(testId)
          ) as { id: string; status: string } | undefined;

          return reply.send({
            success: true,
            data: null,
            pending: pending ? { taskId: pending.id, status: pending.status } : null,
          });
        } catch (error) {
          fastify.log.error(error);
          return reply.status(500).send({
            success: false,
            error: 'Failed to fetch test analysis',
          });
        }
      }
    );

    // GET /api/failure-categories - get distinct failure categories from test_runs
    fastify.get(
      '/api/failure-categories',
      async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
          const db = getDatabase();
          const rows = db
            .prepare(
              'SELECT DISTINCT failure_category FROM test_runs WHERE failure_category IS NOT NULL'
            )
            .all() as Array<{ failure_category: string }>;

          const categories = rows.map((row) => row.failure_category);
          return reply.send({ success: true, data: categories });
        } catch (error) {
          return reply.status(500).send({
            success: false,
            error: 'Failed to fetch failure categories',
          });
        }
      }
    );
  });
}
