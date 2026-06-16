/**
 * Routes exclusively consumed by the pwrs-cli (and the matching Claude Code
 * skill). Lives in its own file so the CLI's contract evolves without polluting
 * the dashboard routes, and so adding/removing CLI surface is a single-file
 * change.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseFailureDetails } from '../lib/failure-clustering/extractors/failure-details.js';
import { FAILED_OUTCOMES } from '../lib/failure-clustering/types.js';
import { buildTestAnalysisRequest } from '../lib/llm/queue/index.js';
import {
  SubmitProjectSummaryRequestSchema,
  SubmitReportSummaryRequestSchema,
  SubmitTestAnalysisRequestSchema,
} from '../lib/schemas/index.js';
import {
  buildAttachmentUrls,
  buildClusterBrief,
  buildFailureCategories,
  buildProjectSummary,
  buildReportBrief,
  buildReportResolve,
  buildReportSummary,
  buildTestAnalysis,
  buildTestBrief,
  buildTestHistory,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  resolveTestIdentity,
  resolveTestRun,
} from '../lib/service/cli-briefs.js';
import {
  failureSummaryDb,
  llmTasksDb,
  projectSummaryDb,
  regressionsDb,
  reportDb,
  testAnalysisDb,
  testDb,
} from '../lib/service/db/index.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

export async function registerCliRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(async (api) => {
    api.addHook('preHandler', (request, reply) => authenticate(request as AuthRequest, reply));

    api.get('/api/cli/test/:testId/brief', async (request: FastifyRequest, reply: FastifyReply) => {
      const { testId } = request.params as { testId: string };
      const { project } = request.query as { project?: string };
      const resolved = resolveTestIdentity(testId, project);
      if (!resolved) {
        return reply.status(404).send({
          success: false,
          error: 'Test not found — pass --project, or ensure the testId has a run',
        });
      }
      const { result: brief, error } = await withError(
        buildTestBrief(resolved.testId, resolved.fileId, resolved.project)
      );
      if (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to build test brief' });
      }
      if (!brief) {
        return reply.status(404).send({ success: false, error: 'Test not found' });
      }
      return reply.send({ success: true, data: brief });
    });

    api.get(
      '/api/cli/test/:testId/analysis',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { project } = request.query as { project?: string };
        const resolved = resolveTestIdentity(testId, project);
        if (!resolved) {
          return reply.status(404).send({
            success: false,
            error: 'Test not found — pass --project, or ensure the testId has a run',
          });
        }
        const { result: analysis, error } = await withError(
          buildTestAnalysis(resolved.testId, resolved.fileId, resolved.project)
        );
        if (error) {
          fastify.log.error(error);
          return reply.status(500).send({ success: false, error: 'Failed to fetch test analysis' });
        }
        return reply.send({ success: true, data: analysis });
      }
    );

    api.get(
      '/api/cli/test/:testId/failure-context',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { project, reportId } = request.query as { project?: string; reportId?: string };
        if (!reportId) {
          return reply
            .status(400)
            .send({ success: false, error: 'reportId query parameter is required' });
        }
        const resolved = resolveTestIdentity(testId, project);
        if (!resolved) {
          return reply.status(404).send({
            success: false,
            error: 'Test not found — pass --project, or ensure the testId has a run',
          });
        }
        const { result: built, error } = await withError(
          buildTestAnalysisRequest({
            testId: resolved.testId,
            fileId: resolved.fileId,
            project: resolved.project,
            reportId,
          })
        );
        if (error) {
          fastify.log.error(error);
          return reply
            .status(500)
            .send({ success: false, error: 'Failed to build failure context' });
        }
        if (!built) {
          return reply
            .status(404)
            .send({ success: false, error: 'No failure details for this test+report' });
        }
        if ('error' in built) {
          return reply.status(404).send({ success: false, error: built.error });
        }
        const evidence = built.details.evidence;
        const reportRow = reportDb.getByID(reportId);
        const attachmentUrls = buildAttachmentUrls(reportRow?.reportUrl, built.details.attachments);
        return reply.send({
          success: true,
          data: {
            markdown: built.debugPrompt,
            segments: built.segmentedPrompt,
            heuristicCategory: built.heuristicCategory,
            attachments: attachmentUrls,
            evidence: evidence
              ? {
                  errorMessage: evidence.errorMessage,
                  stackTrace: evidence.stackTrace,
                  testSourceFrame: evidence.testSourceFrame,
                  stepTree: evidence.stepTree,
                  pageSnapshot: evidence.pageSnapshot,
                  stdout: evidence.stdout,
                  stderr: evidence.stderr,
                  testMeta: evidence.testMeta,
                  gitCommit: evidence.gitCommit,
                  ciBuild: evidence.ciBuild,
                  gitDiff: evidence.gitDiff,
                  environment: evidence.environment,
                  consoleEvents: evidence.consoleEvents,
                  networkEvents: evidence.networkEvents,
                  actionLog: evidence.actionLog,
                }
              : null,
            meta: {
              testId: resolved.testId,
              fileId: resolved.fileId,
              project: resolved.project,
              reportId,
            },
          },
        });
      }
    );

    api.get(
      '/api/cli/test/:testId/analysis-prompt',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { project, reportId, taskId } = request.query as {
          project?: string;
          reportId?: string;
          taskId?: string;
        };
        if (!reportId) {
          return reply
            .status(400)
            .send({ success: false, error: 'reportId query parameter is required' });
        }
        const resolved = resolveTestIdentity(testId, project);
        if (!resolved) {
          return reply.status(404).send({ success: false, error: 'Test not found' });
        }
        let task = taskId ? llmTasksDb.getById(taskId) : null;
        if (!task) {
          task = llmTasksDb.getLatestCompletedTestAnalysisTask(resolved.testId, reportId);
        }
        if (!task || !task.prompt) {
          return reply
            .status(404)
            .send({ success: false, error: 'No completed analysis task for this test+report' });
        }
        return reply.send({
          success: true,
          data: {
            markdown: task.prompt,
            taskId: task.id,
            model: task.model,
            completedAt: task.completedAt,
            status: task.status,
            category: task.category,
            analysisText: task.result,
            meta: {
              testId: resolved.testId,
              fileId: resolved.fileId,
              project: resolved.project,
              reportId,
            },
          },
        });
      }
    );

    api.get(
      '/api/cli/test/:testId/history',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const { project, limit } = request.query as { project?: string; limit?: string };
        const resolved = resolveTestIdentity(testId, project);
        if (!resolved) {
          return reply.status(404).send({
            success: false,
            error: 'Test not found — pass --project, or ensure the testId has a run',
          });
        }
        const requestedLimit = limit ? Number.parseInt(limit, 10) : DEFAULT_HISTORY_LIMIT;
        const normalizedRequest = Number.isFinite(requestedLimit)
          ? requestedLimit
          : DEFAULT_HISTORY_LIMIT;
        const cappedLimit = Math.min(Math.max(normalizedRequest, 1), MAX_HISTORY_LIMIT);
        const { result: history, error } = await withError(
          buildTestHistory(
            resolved.testId,
            resolved.fileId,
            resolved.project,
            cappedLimit,
            normalizedRequest
          )
        );
        if (error) {
          fastify.log.error(error);
          return reply.status(500).send({ success: false, error: 'Failed to build test history' });
        }
        if (!history) {
          return reply.status(404).send({ success: false, error: 'Test not found' });
        }
        return reply.send({ success: true, data: history });
      }
    );

    api.get('/api/cli/report/:id/brief', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { mode } = request.query as { mode?: string };
      const full = mode === 'full';
      const { result: brief, error } = await withError(buildReportBrief(id, full));
      if (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to build report brief' });
      }
      if (!brief) {
        return reply.status(404).send({ success: false, error: 'Report not found' });
      }
      return reply.send({ success: true, data: brief });
    });

    api.get('/api/cli/cluster/:id/brief', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { project } = request.query as { project?: string };
      const { result: brief, error } = await withError(buildClusterBrief(id, project));
      if (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to build cluster brief' });
      }
      if (!brief) {
        return reply.status(404).send({ success: false, error: 'Cluster not found' });
      }
      return reply.send({ success: true, data: brief });
    });

    api.get('/api/cli/report/:id/summary', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { result: summary, error } = await withError(buildReportSummary(id));
      if (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to fetch report summary' });
      }
      if (!summary) {
        return reply.status(404).send({ success: false, error: 'Report not found' });
      }
      return reply.send({ success: true, data: summary });
    });

    api.get(
      '/api/cli/project/:project/summary',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { project } = request.params as { project: string };
        const { result: summary, error } = await withError(buildProjectSummary(project || 'all'));
        if (error) {
          fastify.log.error(error);
          return reply
            .status(500)
            .send({ success: false, error: 'Failed to fetch project summary' });
        }
        return reply.send({ success: true, data: summary });
      }
    );

    api.get('/api/cli/report/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
      const { displayNumber, project } = request.query as {
        displayNumber?: string;
        project?: string;
      };
      if (!displayNumber) {
        return reply.status(400).send({
          success: false,
          error: 'displayNumber query parameter is required',
        });
      }
      const parsed = Number.parseInt(displayNumber, 10);
      if (!Number.isFinite(parsed)) {
        return reply.status(400).send({
          success: false,
          error: `displayNumber must be an integer (got '${displayNumber}')`,
        });
      }
      const { result: matches, error } = await withError(buildReportResolve(parsed, project));
      if (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to resolve displayNumber' });
      }
      return reply.send({
        success: true,
        data: { displayNumber: parsed, project: project ?? null, matches: matches ?? [] },
      });
    });

    api.get('/api/cli/test/proximity', async (request: FastifyRequest, reply: FastifyReply) => {
      const { testIds: testIdsRaw, project } = request.query as {
        testIds?: string;
        project?: string;
      };
      if (!testIdsRaw) {
        return reply
          .status(400)
          .send({ success: false, error: 'testIds query parameter is required (comma-separated)' });
      }
      const ids = testIdsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const PROXIMITY_MAX_IDS = 200;
      if (ids.length === 0) {
        return reply.send({ success: true, data: { rows: [] } });
      }
      if (ids.length > PROXIMITY_MAX_IDS) {
        return reply.status(400).send({
          success: false,
          error: `Too many testIds (got ${ids.length}, max ${PROXIMITY_MAX_IDS})`,
        });
      }
      const rows = testDb.getLatestFailedRunsByTestIds(ids, project);
      const out: Array<{ testId: string; filePath?: string; line?: number; column?: number }> = [];
      for (const row of rows.values()) {
        const parsed = parseFailureDetails(row.failureDetails);
        const location = parsed?.location;
        out.push({
          testId: row.testId,
          filePath: location?.file ?? parsed?.filePath,
          line: location?.line,
          column: location?.column,
        });
      }
      return reply.send({ success: true, data: { rows: out } });
    });

    api.get('/api/cli/regression/list', async (request: FastifyRequest, reply: FastifyReply) => {
      const { project, active, resolved, from, to, sort, limit } = request.query as {
        project?: string;
        active?: string;
        resolved?: string;
        from?: string;
        to?: string;
        sort?: string;
        limit?: string;
      };
      const openFilter = active === 'true' ? true : resolved === 'true' ? false : undefined;
      const sortKey = sort === 'recent' || sort === 'oldest' || sort === 'impact' ? sort : 'impact';
      const parsedLimit = limit ? Number.parseInt(limit, 10) : 25;
      const cappedLimit =
        Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 25;

      const { data, total } = regressionsDb.list({
        project: project && project !== 'all' ? project : undefined,
        open: openFilter,
        since: from,
        until: to,
        limit: cappedLimit,
        sort: sortKey,
      });

      const rows = data.map((r) => {
        const live = r.daysOpen ?? (Date.now() - Date.parse(r.regressedAtCreatedAt)) / 86_400_000;
        return {
          id: r.id,
          testId: r.testId,
          fileId: r.fileId,
          project: r.project,
          title: r.title ?? null,
          filePath: r.filePath ?? null,
          regressedAtReportId: r.regressedAtReportId,
          regressedAtDisplayNumber: r.regressedDisplayNumber,
          regressedAtCreatedAt: r.regressedAtCreatedAt,
          regressedAtCommit: r.regressedAtCommit,
          regressedAtCategory: r.regressedAtCategory,
          lastGreenReportId: r.lastGreenReportId,
          lastGreenDisplayNumber: r.lastGreenDisplayNumber,
          lastGreenCreatedAt: r.lastGreenCreatedAt,
          lastGreenCommit: r.lastGreenCommit,
          recoveredAtReportId: r.recoveredAtReportId,
          recoveredAtCreatedAt: r.recoveredAtCreatedAt,
          recoveredAtCommit: r.recoveredAtCommit,
          daysOpen: Math.round(live * 10) / 10,
          failureCount: r.failureCount,
          flakyCount: r.flakyCount,
          isActive: r.recoveredAtReportId === null,
        };
      });

      return reply.send({
        success: true,
        data: { rows, total, hasMore: total > rows.length },
      });
    });

    api.get('/api/cli/categories', async (request: FastifyRequest, reply: FastifyReply) => {
      const { project } = request.query as { project?: string };
      const { result: categories, error } = await withError(buildFailureCategories(project));
      if (error) {
        fastify.log.error(error);
        return reply
          .status(500)
          .send({ success: false, error: 'Failed to fetch failure categories' });
      }
      return reply.send({ success: true, data: { project: project ?? null, categories } });
    });

    api.post(
      '/api/cli/test/:testId/analysis',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { testId } = request.params as { testId: string };
        const parsed = SubmitTestAnalysisRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ success: false, error: parsed.error.message });
        }
        const body = parsed.data;
        const tr = resolveTestRun(testId, body.reportId);
        if (!tr) {
          return reply.status(404).send({
            success: false,
            error: `No test_run for testId=${testId} in report=${body.reportId}`,
          });
        }
        const existing = testAnalysisDb.getByTestAndReport(testId, body.reportId);
        if (existing && !body.force) {
          return reply.status(409).send({
            success: false,
            error:
              'Analysis already exists for this (testId, reportId). Use feedback to dissent, or pass force=true to overwrite.',
            data: {
              existingModel: existing.model,
              existingUpdatedAt: existing.updatedAt ?? existing.createdAt,
            },
          });
        }
        const row = testAnalysisDb.upsert(
          testId,
          tr.fileId,
          tr.project,
          body.reportId,
          body.analysis,
          body.category,
          body.model,
          existing?.attempt ?? 1
        );
        return reply.send({
          success: true,
          data: {
            testId: row.testId,
            fileId: row.fileId,
            project: row.project,
            reportId: row.reportId,
            model: row.model,
            category: row.category,
            updatedAt: row.updatedAt,
            overwrote: !!existing,
          },
        });
      }
    );

    api.post(
      '/api/cli/report/:id/summary',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id: reportId } = request.params as { id: string };
        const parsed = SubmitReportSummaryRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ success: false, error: parsed.error.message });
        }
        const body = parsed.data;
        const report = reportDb.getByID(reportId);
        if (!report) {
          return reply.status(404).send({ success: false, error: `Report ${reportId} not found` });
        }
        const existing = failureSummaryDb.getSummary(reportId);
        if (existing?.llmSummary && !body.force) {
          return reply.status(409).send({
            success: false,
            error:
              'Summary already exists for this report. Pass force=true to overwrite (do so only after user confirmation).',
            data: {
              existingModel: existing.llmModel,
              existingUpdatedAt: existing.updatedAt ?? existing.createdAt,
            },
          });
        }
        if (!existing) {
          const runs = testDb.getTestRunsByReport(reportId);
          const categories: Record<string, number> = {};
          let totalFailures = 0;
          for (const r of runs) {
            if (!FAILED_OUTCOMES.has(r.outcome)) continue;
            totalFailures++;
            if (r.failureCategory) {
              categories[r.failureCategory] = (categories[r.failureCategory] ?? 0) + 1;
            }
          }
          failureSummaryDb.upsertSummary(reportId, report.project, totalFailures, categories);
        }
        failureSummaryDb.updateLlmSummary(
          reportId,
          body.llmSummary,
          body.llmSummaryStructured ?? null,
          body.model
        );
        const after = failureSummaryDb.getSummary(reportId);
        return reply.send({
          success: true,
          data: {
            reportId,
            project: report.project,
            model: after?.llmModel ?? body.model,
            updatedAt: after?.updatedAt,
            overwrote: !!existing?.llmSummary,
          },
        });
      }
    );

    api.post(
      '/api/cli/project/:project/summary',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { project } = request.params as { project: string };
        const parsed = SubmitProjectSummaryRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ success: false, error: parsed.error.message });
        }
        const body = parsed.data;
        const existing = projectSummaryDb.get(project);
        if (existing && !body.force) {
          return reply.status(409).send({
            success: false,
            error:
              'Project summary already exists. Pass force=true to overwrite (do so only after user confirmation).',
            data: {
              existingModel: existing.model,
              existingUpdatedAt: existing.updatedAt,
              existingLastReportId: existing.lastReportId,
            },
          });
        }
        projectSummaryDb.upsert({
          project,
          summary: body.summary,
          structured: body.structured ? JSON.stringify(body.structured) : null,
          model: body.model,
          lastReportId: body.lastReportId,
          reportCount: body.reportCount,
          firstReportAt: body.firstReportAt,
          lastReportAt: body.lastReportAt,
        });
        const after = projectSummaryDb.get(project);
        return reply.send({
          success: true,
          data: {
            project,
            model: after?.model ?? body.model,
            updatedAt: after?.updatedAt,
            overwrote: !!existing,
          },
        });
      }
    );
  });
}
