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
import { projectSummaryDb } from '../lib/service/db/projectSummary.sqlite.js';
import { reportDb } from '../lib/service/db/reports.sqlite.js';
import { testAnalysisDb } from '../lib/service/db/testAnalysis.sqlite.js';
import { testDb } from '../lib/service/db/tests.sqlite.js';
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
      if (authResult) return;

      const {
        project = 'all',
        from,
        to,
        failedOnly,
      } = request.query as {
        project?: string;
        from?: string;
        to?: string;
        failedOnly?: string;
      };
      const failedOnlyFlag = failedOnly === 'true' || failedOnly === '1';
      const analyticsData = await analyticsService.getAnalyticsData(
        project,
        from,
        to,
        failedOnlyFlag
      );

      return { success: true, data: analyticsData };
    } catch (error) {
      reply.status(500);
      return {
        success: false,
        error: `Failed to fetch analytics data: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  // POST /api/llm/analyze-failed-test - enqueue a fresh analysis run for the
  // given (testId, reportId). User-driven (Ask LLM button); always treated as
  // an explicit retry so the queue bypasses cross-report reuse and replaces
  // any existing row on success. Returns the enqueued task id; the caller
  // tracks status via /api/llm/task-progress/:taskId and re-fetches
  // /api/test-analysis/:testId once the task completes.
  fastify.post('/api/llm/analyze-failed-test', async (request, reply) => {
    try {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;

      const { testId, reportId } = request.body as { testId: string; reportId: string };

      if (!testId || !reportId) {
        return reply.status(400).send({ success: false, error: 'Missing testId or reportId' });
      }

      if (!llmService.isConfigured()) {
        return reply.status(400).send({
          success: false,
          error: 'LLM service is not enabled. Set LLM_BASE_URL and LLM_API_KEY to enable',
        });
      }

      const tr = resolveTestRun(testId, reportId);
      if (!tr) {
        return reply.status(404).send({
          success: false,
          error: `No test_run for testId=${testId} in report=${reportId}`,
        });
      }

      const db = getDatabase();
      const inflightTest = db
        .prepare(
          `SELECT id FROM llm_tasks
           WHERE type = 'test_analysis'
             AND testId = ? AND reportId = ?
             AND status IN ('queued','processing')
           ORDER BY createdAt DESC
           LIMIT 1`
        )
        .get(testId, reportId) as { id: string } | undefined;

      let taskId: string;
      let deduped: boolean;
      if (inflightTest) {
        // Coalesce duplicate clicks while a task is already in flight. Upgrade
        // to a retry so the worker (if still queued) skips reuse.
        taskId = inflightTest.id;
        deduped = true;
        llmTasksDb.markAsRetry(taskId);
      } else {
        const created = llmTasksDb.createTask('test_analysis', {
          reportId,
          testId,
          fileId: tr.fileId,
          project: tr.project,
          isRetry: true,
        });
        taskId = created.id;
        deduped = false;
      }

      return reply.send({ success: true, data: { taskId, deduped } });
    } catch (error) {
      fastify.log.error({
        error: 'LLM analyze-failed-test enqueue error',
        message: error instanceof Error ? error.message : String(error),
      });
      return reply.status(500).send({ success: false, error: 'Failed to enqueue analysis task' });
    }
  });

  // GET /api/report/:id/failure-summary - get stored failure summary for a report
  fastify.get(
    '/api/report/:id/failure-summary',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authResult = await authenticate(request as AuthRequest, reply);
        if (authResult) return;

        const { id } = request.params as { id: string };
        const summary = failureSummaryDb.getSummary(id);

        // The UI uses `hasFailures` to decide whether to show the "Summarize" button.
        const runs = testDb.getTestRunsByReport(id);
        const hasFailures = runs.some(
          (r) => r.outcome === 'unexpected' || r.outcome === 'failed' || r.outcome === 'flaky'
        );

        // Surface in-flight LLM task count so the UI can disable Summarize while a
        // queued or processing analysis is already in progress for this report.
        const pendingAnalysisCount = llmTasksDb.getInflightCountForReport(id);

        return reply.send({
          success: true,
          data: summary ?? null,
          hasFailures,
          pendingAnalysisCount,
        });
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
    if (authResult) return;

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
      let skipped = 0;
      let project: string | undefined;

      const { detectFailureCategory } = await import('../lib/service/testManagement.js');
      const db = getDatabase();

      const findReuseSource = (
        testId: string,
        fileId: string,
        proj: string,
        errorSignature: string | undefined,
        heuristicCategory: string,
        currentReportId: string
      ) => {
        if (!errorSignature) return null;
        return db
          .prepare(
            `SELECT tla.id, tla.reportId, tla.analysis, tla.category, tla.model
             FROM test_llm_analyses tla
             JOIN test_runs tr ON tr.testId = tla.testId
                              AND tr.fileId = tla.fileId
                              AND tr.project = tla.project
                              AND tr.reportId = tla.reportId
             WHERE tla.testId = ? AND tla.fileId = ? AND tla.project = ?
               AND tr.error_signature = ?
               AND tr.failure_category = ?
               AND tla.analysis IS NOT NULL
               AND TRIM(tla.analysis) != ''
               AND tla.reportId != ?
             ORDER BY datetime(COALESCE(tla.updatedAt, tla.createdAt)) DESC
             LIMIT 1`
          )
          .get(testId, fileId, proj, errorSignature, heuristicCategory, currentReportId) as
          | {
              id: string;
              reportId: string;
              analysis: string;
              category: string | null;
              model: string | null;
            }
          | undefined;
      };

      for (const run of failedRuns) {
        const key = `${run.testId}:${run.fileId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        project ??= run.project;

        const existing = testAnalysisDb.getByTestAndReport(run.testId, id);
        if (existing?.analysis && existing.analysis.trim() !== '') {
          skipped++;
          continue;
        }

        // Strict propagation: only mirror an existing analysis when both the
        // normalized error_signature AND the heuristic failure category match
        // the prior run's. Otherwise enqueue a fresh test_analysis task — a
        // truly different failure deserves its own analysis. The user can
        // force a fresh analysis on a per-test basis via /api/llm/regenerate
        // or by clicking Retry on the inline widget.
        const heuristicCategory = run.failureDetails
          ? detectFailureCategory(JSON.parse(run.failureDetails)?.message ?? '')
          : detectFailureCategory('');
        const reuseSource = findReuseSource(
          run.testId,
          run.fileId,
          run.project,
          run.errorSignature,
          heuristicCategory,
          id
        );

        if (reuseSource) {
          skipped++;
          // Mirror the qualifying analysis to the current reportId so the
          // report_summary task (which loads via testAnalysisDb.getByReport)
          // can include it. Without this, a fully-skipped report would
          // summarize from an empty analysis set.
          testAnalysisDb.upsert(
            run.testId,
            run.fileId,
            run.project,
            id,
            reuseSource.analysis,
            reuseSource.category ?? undefined,
            reuseSource.model ?? undefined,
            1,
            reuseSource.id
          );
          if (run.runId && reuseSource.category) {
            testDb.updateFailureCategory(run.runId, reuseSource.category);
          }
          continue;
        }

        llmTasksDb.createTask('test_analysis', {
          reportId: id,
          testId: run.testId,
          fileId: run.fileId,
          project: run.project,
        });
        queued++;
      }

      // Enqueue the report summary as long as there's something to summarize — even when
      // every per-test analysis was skipped because it already exists. Otherwise clicking
      // "Summarize Failures" on a fully-analyzed report would never produce a summary.
      if (queued > 0 || skipped > 0) {
        llmTasksDb.createTask('report_summary', {
          reportId: id,
          project,
          priority: -1,
        });
      }

      return reply.send({ success: true, queued, skipped });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to trigger report analysis',
      });
    }
  });

  // GET /api/analytics/project-summary - return the persisted project-level LLM summary.
  // Keyed by project only — survives page refreshes (and date-range changes) until a new
  // report for the project arrives, which invalidates the cache server-side.
  // Surfaces `pendingAnalysisCount` so the dashboard can drive refetch polling
  // while a project_summary task is in flight.
  fastify.get(
    '/api/analytics/project-summary',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authResult = await authenticate(request as AuthRequest, reply);
        if (authResult) return;

        const { project } = request.query as { project?: string };
        const projectKey = project ?? 'all';

        const row = projectSummaryDb.get(projectKey);
        const pendingAnalysisCount = llmTasksDb.getInflightCountForProject(projectKey);
        // Parse the JSON-serialized structured payload before sending to the
        // client so the wire format stays a plain object, not a string-in-a-string.
        let structured: unknown = null;
        if (row?.structured) {
          try {
            structured = JSON.parse(row.structured);
          } catch (err) {
            fastify.log.warn(
              `[analytics] failed to parse stored project_summary structured JSON: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        const responseData = row
          ? {
              project: row.project,
              summary: row.summary,
              structured,
              model: row.model,
              lastReportId: row.lastReportId,
              reportCount: row.reportCount,
              firstReportAt: row.firstReportAt,
              lastReportAt: row.lastReportAt,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            }
          : null;
        return reply.send({
          success: true,
          data: responseData,
          pendingAnalysisCount,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to fetch project summary' });
      }
    }
  );

  // POST /api/analytics/failure-categories/llm - enqueue a project_summary task.
  // The queue worker runs the LLM call and writes both the llm_tasks row and
  // projectSummaryDb cache. The UI tracks progress by polling
  // /api/analytics/project-summary (which surfaces pendingAnalysisCount).
  fastify.post(
    '/api/analytics/failure-categories/llm',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authResult = await authenticate(request as AuthRequest, reply);
        if (authResult) return;

        const { project } = request.query as { project?: string };
        const body = (request.body ?? {}) as { reportIds?: unknown };
        const explicitReportIds: string[] | undefined = Array.isArray(body.reportIds)
          ? (body.reportIds.filter((x) => typeof x === 'string') as string[])
          : undefined;

        if (!llmService.isConfigured()) {
          return reply.status(400).send({
            success: false,
            error: 'LLM service is not configured',
          });
        }

        const projectKey = project || 'all';
        const hasExplicit = !!explicitReportIds && explicitReportIds.length > 0;

        let latestReports: ReturnType<typeof reportDb.getLatestByProject>;
        if (hasExplicit) {
          const fetched = (explicitReportIds as string[])
            .map((rid) => reportDb.getByID(rid))
            .filter((r): r is NonNullable<typeof r> => !!r);
          latestReports = fetched
            .sort(
              (a, b) =>
                new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()
            )
            .slice(0, 10);
        } else {
          latestReports = reportDb.getLatestByProject(project || undefined, 10);
        }
        if (latestReports.length === 0) {
          return reply.status(400).send({
            success: false,
            error: hasExplicit
              ? 'None of the supplied reportIds resolved to reports.'
              : 'No reports available for this project.',
          });
        }

        const hasAnyFailures = latestReports.some(
          (r) => r.stats && ((r.stats.unexpected ?? 0) > 0 || (r.stats.flaky ?? 0) > 0)
        );

        // No failures → no LLM call needed. Persist a canned all-green message
        // synchronously so a refresh shows it.
        if (!hasAnyFailures) {
          const lastReportId = latestReports[0]?.reportID;
          const reportTimes = latestReports
            .map((r) => (r.createdAt ? new Date(String(r.createdAt)).getTime() : Number.NaN))
            .filter((t) => Number.isFinite(t)) as number[];
          const firstReportAt = reportTimes.length
            ? new Date(Math.min(...reportTimes)).toISOString()
            : undefined;
          const lastReportAt = reportTimes.length
            ? new Date(Math.max(...reportTimes)).toISOString()
            : undefined;
          const msg = `All ${latestReports.length} latest test runs passed without failures. Everything is looking good!`;
          const structuredAllGreen = {
            verdict: 'healthy' as const,
            summary: msg,
            sections: [
              {
                heading: 'Health Assessment',
                body: `All ${latestReports.length} latest runs passed cleanly. No failures observed.`,
              },
            ],
            latestReportId: lastReportId,
          };
          projectSummaryDb.upsert({
            project: projectKey,
            summary: msg,
            structured: JSON.stringify(structuredAllGreen),
            lastReportId,
            reportCount: latestReports.length,
            firstReportAt,
            lastReportAt,
          });
          return reply.send({ success: true, data: { allGreen: true } });
        }

        // Coalesce duplicate clicks while a task is already in flight.
        const db = getDatabase();
        const inflight = db
          .prepare(
            `SELECT id FROM llm_tasks
             WHERE type = 'project_summary'
               AND project = ?
               AND status IN ('queued','processing')
             ORDER BY createdAt DESC
             LIMIT 1`
          )
          .get(projectKey) as { id: string } | undefined;

        const resolvedReportIds = hasExplicit ? latestReports.map((r) => r.reportID) : null;

        let taskId: string;
        let deduped: boolean;
        if (inflight) {
          taskId = inflight.id;
          deduped = true;
          llmTasksDb.markAsRetry(taskId);
          llmTasksDb.updateReportIds(taskId, resolvedReportIds);
        } else {
          const created = llmTasksDb.createTask('project_summary', {
            project: projectKey,
            isRetry: true,
            reportIds: resolvedReportIds ?? undefined,
          });
          taskId = created.id;
          deduped = false;
        }

        return reply.send({ success: true, data: { taskId, deduped } });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to enqueue project failure summary',
        });
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
    if (authResult) return;

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
    if (authResult) return;

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
    if (authResult) return;

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
    if (authResult) return;

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
           AND testId = ? AND reportId = ?
           AND status IN ('queued','processing')
         ORDER BY createdAt DESC
         LIMIT 1`
      )
      .get(body.testId, body.reportId ?? '') as { id: string } | undefined;

    let taskId: string;
    let deduped: boolean;
    if (inflightTest) {
      taskId = inflightTest.id;
      deduped = true;
      // Regenerate is an explicit user request for fresh analysis. If the
      // deduped task was auto-queued (isRetry=0), upgrade it so the queue
      // bypasses reuse-by-signature when it picks the row up.
      llmTasksDb.markAsRetry(taskId);
    } else {
      const created = llmTasksDb.createTask('test_analysis', {
        reportId: body.reportId,
        testId: body.testId,
        fileId: keys.fileId,
        project: keys.project,
        isRetry: true,
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
    if (authResult) return;

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
    if (authResult) return;

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
    const excludeReportId = reportId ?? '';
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
