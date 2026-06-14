import type { TestWithQuarantineInfo } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { llmTasksDb } from '../lib/service/db/llmTasks.sqlite.js';
import { regressionsDb, toRegressionContext } from '../lib/service/db/regressions.sqlite.js';
import { testAnalysisDb } from '../lib/service/db/testAnalysis.sqlite.js';
import { testDb } from '../lib/service/db/tests.sqlite.js';
import { testManagementService } from '../lib/service/testManagement.js';
import { buildTestAnalysisRequest } from '../lib/llm/queue/index.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

export async function registerTestsRoutes(fastify: FastifyInstance) {
  await fastify.register(async (fastify) => {
    fastify.addHook('preHandler', (request, reply) => authenticate(request as AuthRequest, reply));

    fastify.get('/api/tests', async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        project,
        status,
        tiers,
        sort,
        failureCategory,
        limit,
        offset,
        from,
        to,
        search,
        regressedOnly,
        regressedSince,
        resolvedSince,
      } = request.query as {
        project?: string;
        status?: string;
        tiers?: string;
        sort?: string;
        failureCategory?: string;
        limit?: string;
        offset?: string;
        from?: string;
        to?: string;
        search?: string;
        regressedOnly?: string;
        regressedSince?: string;
        resolvedSince?: string;
      };

      try {
        const parsedTiers = tiers
          ? (tiers
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t === 'stable' || t === 'flaky' || t === 'critical') as Array<
              'stable' | 'flaky' | 'critical'
            >)
          : undefined;
        const options = {
          status: status as 'all' | 'quarantined' | 'not-quarantined' | undefined,
          tiers: parsedTiers,
          sort:
            sort === 'slowest'
              ? ('slowest' as const)
              : sort === 'stale'
                ? ('stale' as const)
                : sort === 'regression-age'
                  ? ('regression-age' as const)
                  : undefined,
          failureCategory: failureCategory || undefined,
          limit: limit ? Number.parseInt(limit, 10) : undefined,
          offset: offset ? Number.parseInt(offset, 10) : undefined,
          from,
          to,
          search,
          regressedOnly: regressedOnly === 'true',
          regressedSince: regressedSince || undefined,
          resolvedSince: resolvedSince || undefined,
        };

        const { data, total } = await testManagementService.getTests(project, options);

        if (data.length > 0) {
          const keys = data.map((t) => ({
            testId: t.testId,
            fileId: t.fileId,
            project: t.project,
          }));
          const openMap = regressionsDb.getOpenForTests(keys);
          const onlyActiveFilter =
            options.regressedOnly && !options.regressedSince && !options.resolvedSince;
          const highlightMap = regressionsDb.getRegressionHighlightsForTests(
            keys,
            onlyActiveFilter ? undefined : from,
            onlyActiveFilter ? undefined : to
          );
          for (const t of data as TestWithQuarantineInfo[]) {
            const k = `${t.testId}::${t.fileId}::${t.project}`;
            const reg = openMap.get(k);
            if (reg) t.regression = toRegressionContext(reg);
            const hl = highlightMap.get(k);
            if (hl) t.regressionHighlights = hl;
          }
        }

        return reply.send({ success: true, data, total });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to fetch tests',
        });
      }
    });

    fastify.get('/api/test/:testId', async (request: FastifyRequest, reply: FastifyReply) => {
      const { testId } = request.params as { testId: string };
      const { project } = request.query as { project?: string };

      const lane = testDb.findByTestId(testId, project);
      if (!lane) {
        return reply.status(404).send({ success: false, error: 'Test not found' });
      }

      const { result: test, error } = await withError(
        testManagementService.getTest(lane.testId, lane.fileId, lane.project)
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
    });

    fastify.delete('/api/test/:testId', async (request: FastifyRequest, reply: FastifyReply) => {
      const { testId } = request.params as { testId: string };
      const { project } = request.query as { project: string };

      if (!project) {
        return reply
          .status(400)
          .send({ success: false, error: 'project query parameter is required' });
      }

      const lane = testDb.findByTestId(testId, project);
      if (!lane) {
        return reply.status(404).send({ success: false, error: 'Test not found' });
      }

      const { error } = await withError(
        testManagementService.deleteTest(lane.testId, lane.fileId, lane.project)
      );

      if (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to delete test' });
      }

      return reply.send({ success: true });
    });

    fastify.patch('/api/test/:testId', async (request: FastifyRequest, reply: FastifyReply) => {
      const { testId } = request.params as { testId: string };
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

      const lane = testDb.findByTestId(testId, project);
      if (!lane) {
        return reply.status(404).send({ success: false, error: 'Test not found' });
      }

      const { error } = await withError(
        testManagementService.updateQuarantineStatus(
          lane.testId,
          lane.fileId,
          lane.project,
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
          testId: lane.testId,
          fileId: lane.fileId,
          isQuarantined: body.isQuarantined,
          reason: body.reason,
        },
      });
    });

    fastify.post(
      '/api/test/:testId/flakiness-reset',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { project } = request.query as { project?: string };

        if (!project) {
          return reply
            .status(400)
            .send({ success: false, error: 'project query parameter is required' });
        }

        const lane = testDb.findByTestId(testId, project);
        if (!lane) {
          return reply.status(404).send({ success: false, error: 'Test not found' });
        }

        const { error } = await withError(
          testManagementService.resetFlakiness(lane.testId, lane.fileId, lane.project)
        );

        if (error) {
          fastify.log.error(error);
          return reply
            .status(500)
            .send({ success: false, error: 'Failed to reset flakiness score' });
        }

        return reply.send({ success: true });
      }
    );

    fastify.delete(
      '/api/test/:testId/flakiness-reset',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { project } = request.query as { project?: string };

        if (!project) {
          return reply
            .status(400)
            .send({ success: false, error: 'project query parameter is required' });
        }

        const lane = testDb.findByTestId(testId, project);
        if (!lane) {
          return reply.status(404).send({ success: false, error: 'Test not found' });
        }

        const { error } = await withError(
          testManagementService.clearFlakinessReset(lane.testId, lane.fileId, lane.project)
        );

        if (error) {
          fastify.log.error(error);
          return reply
            .status(500)
            .send({ success: false, error: 'Failed to clear flakiness reset' });
        }

        return reply.send({ success: true });
      }
    );

    fastify.get(
      '/api/test/:testId/detail',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { project } = request.query as { project?: string };

        const lane = testDb.findByTestId(testId, project);
        if (!lane) {
          return reply.status(404).send({ success: false, error: 'Test not found' });
        }

        const { result: detail, error } = await withError(
          testManagementService.getTestDetail(lane.testId, lane.fileId, lane.project)
        );

        if (error) {
          fastify.log.error(error);
          return reply.status(500).send({ success: false, error: 'Failed to fetch test detail' });
        }

        if (!detail) {
          return reply.status(404).send({ success: false, error: 'Test not found' });
        }

        return reply.send({ success: true, data: detail });
      }
    );

    // GET /api/test/:testId/analysis - pre-computed LLM analysis for a test
    fastify.get(
      '/api/test/:testId/analysis',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { project } = request.query as { project: string };

        if (!project) {
          return reply
            .status(400)
            .send({ success: false, error: 'project query parameter is required' });
        }

        const lane = testDb.findByTestId(testId, project);
        if (!lane) {
          return reply.send({ success: true, data: null });
        }

        try {
          const analysis = testAnalysisDb.getByTest(lane.testId, lane.fileId, lane.project);

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
          // retry takes precedence over the stored row: while a
          // retry-flagged task for this (testId, reportId) is still in flight,
          // surface it as pending so the viewer renders "regenerating…" instead
          // of the about-to-be-replaced analysis. Auto-queued (isRetry=0) tasks
          // do NOT preempt — those run as background fill-in and shouldn't hide
          // an existing analysis from the user.
          const retryPending = llmTasksDb.findInflightTestAnalysis(testId, reportId, {
            retryOnly: true,
          });

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
          const taskRow = llmTasksDb.getLatestCompletedTestAnalysisResult(testId, reportId);

          if (taskRow) {
            return reply.send({ success: true, data: taskRow });
          }

          // No completed analysis yet — surface in-flight tasks so the report viewer
          // can render a loading state instead of nothing while the queue catches up.
          const pending = llmTasksDb.findInflightTestAnalysis(testId, reportId);

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

    // GET /api/test-analysis/:testId/prompt?reportId=...[&refresh=1]
    // The in-report Copy prompt button always passes refresh=1 and gets a
    // fresh build via the same shared builder the queue uses. Callers that
    // omit refresh get the stored llm_tasks.prompt from the latest completed
    // task (the verbatim text we sent on that run); CLI `analysis-prompt`
    // uses this path. Response `source` field is `'stored'` or `'fresh'`.
    fastify.get(
      '/api/test-analysis/:testId/prompt',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { reportId, refresh } = request.query as { reportId?: string; refresh?: string };
        if (!reportId) {
          return reply
            .status(400)
            .send({ success: false, error: 'reportId query parameter is required' });
        }
        // `refresh=1` forces a fresh build, bypassing the stored task. Used by
        // the "Copy prompt (full)" button so the user always sees the prompt
        // the queue would build right now (with the latest evidence shape,
        // the latest history, etc.) — distinct from the verbatim historical
        // prompt the in-analysis Copy prompt button returns.
        const forceFresh = refresh === '1' || refresh === 'true';
        const task = forceFresh
          ? null
          : llmTasksDb.getLatestCompletedTestAnalysisTask(testId, reportId);
        if (task?.prompt) {
          return reply.send({
            success: true,
            data: {
              prompt: task.prompt,
              source: 'stored',
              taskId: task.id,
              model: task.model,
              completedAt: task.completedAt,
            },
          });
        }

        // No completed task — build a fresh would-be prompt. Resolve
        // (fileId, project) from `test_runs` so the shared builder has
        // everything it needs.
        const row = testDb.findRunLaneByReport(testId, reportId);
        if (!row) {
          return reply.status(404).send({
            success: false,
            error: 'No test run found for this test+report',
          });
        }
        const built = await buildTestAnalysisRequest({
          testId,
          fileId: row.fileId,
          project: row.project,
          reportId,
        });
        if ('error' in built) {
          return reply.status(404).send({ success: false, error: built.error });
        }
        return reply.send({
          success: true,
          data: {
            prompt: built.debugPrompt,
            source: 'fresh',
            heuristicCategory: built.heuristicCategory,
          },
        });
      }
    );
  });
}
