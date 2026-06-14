import type { FastifyInstance } from 'fastify';
import { llmService } from '../lib/llm/index.js';
import {
  DeleteFeedbackRequestSchema,
  FeedbackRegenerateRequestSchema,
  GetFeedbackQuerySchema,
  GetRelatedFeedbackQuerySchema,
  UpsertFeedbackRequestSchema,
} from '../lib/schemas/index.js';
import { analysisFeedbackDb } from '../lib/service/db/analysisFeedback.sqlite.js';
import { llmTasksDb } from '../lib/service/db/llmTasks.sqlite.js';
import { reportDb } from '../lib/service/db/reports.sqlite.js';
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
  const report = row.reportId ? reportDb.getByID(row.reportId) : undefined;
  return {
    id: row.id,
    testId: row.testId ?? undefined,
    fileId: row.fileId ?? undefined,
    project: row.project,
    reportId: row.reportId ?? undefined,
    reportDisplayNumber: report?.displayNumber ?? undefined,
    reportTitle: report?.title ?? undefined,
    errorSignature: row.errorSignature ?? undefined,
    comment: row.comment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

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

export async function registerLlmFeedbackRoutes(fastify: FastifyInstance) {
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
          error:
            'LLM service is not enabled. Configure the base URL and API key in Settings → LLM.',
        });
      }

      const tr = resolveTestRun(testId, reportId);
      if (!tr) {
        return reply.status(404).send({
          success: false,
          error: `No test_run for testId=${testId} in report=${reportId}`,
        });
      }

      const inflightTest = llmTasksDb.findInflightTestAnalysis(testId, reportId);

      let taskId: string;
      let deduped: boolean;
      if (inflightTest) {
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

    const existing = analysisFeedbackDb.getByTest(body.testId, keys.fileId, keys.project);
    let errorSignature: string | undefined;
    let originReportId: string | undefined;
    if (!existing) {
      if (keys.signature !== undefined || body.reportId) {
        errorSignature = keys.signature;
        originReportId = body.reportId;
      } else {
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

    const inflightTest = llmTasksDb.findInflightTestAnalysis(body.testId, body.reportId ?? '');

    let taskId: string;
    let deduped: boolean;
    if (inflightTest) {
      taskId = inflightTest.id;
      deduped = true;
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
      const inflightReport = llmTasksDb.findInflightReportSummary(body.reportId);
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

  fastify.get('/api/llm/test-history', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const { testId, reportId, fileId, errorSignature } = request.query as {
      testId?: string;
      reportId?: string;
      fileId?: string;
      errorSignature?: string;
    };
    if (!testId) {
      return reply.status(400).send({ success: false, error: 'testId is required' });
    }

    let resolvedFileId = fileId;
    let resolvedSignature = errorSignature;
    const excludeReportId = reportId ?? '';
    if ((!resolvedFileId || !resolvedSignature) && reportId) {
      const resolved = resolveTestRun(testId, reportId);
      if (!resolved) {
        return reply.send({
          success: true,
          data: { priorOccurrenceCount: 0, firstOccurrence: null },
        });
      }
      resolvedFileId = resolvedFileId ?? resolved.fileId;
      resolvedSignature = resolvedSignature ?? resolved.errorSignature;
    }
    if (!resolvedFileId || !resolvedSignature) {
      return reply.send({
        success: true,
        data: { priorOccurrenceCount: 0, firstOccurrence: null },
      });
    }

    const history = testDb.getFailureHistory(
      testId,
      resolvedFileId,
      resolvedSignature,
      excludeReportId
    );
    return reply.send({ success: true, data: history });
  });
}
