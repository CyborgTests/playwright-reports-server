/**
 * Routes exclusively consumed by the pwrs-cli (and the matching Claude Code
 * skill). Lives in its own file so the CLI's contract evolves without polluting
 * the dashboard routes, and so adding/removing CLI surface is a single-file
 * change.
 *
 * Both endpoints return a "brief" — orthogonal context (LLM analysis, team
 * feedback, cluster membership, first-seen) fanned out server-side so the CLI
 * never has to make N round-trips per test. Error messages and analysis text
 * are passed through verbatim; the only hard cap is on the per-report
 * `failedTests` array size so a 500-failure run can't pull the whole report.
 */
import type { ClusterAnchor, ClusterRegressionContext } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { defaultConfig } from '../lib/config.js';
import { parseFailureDetails } from '../lib/failure-clustering/extractors/failure-details.js';
import { extractFrameFromFailure } from '../lib/failure-clustering/extractors/stack-trace.js';
import { getFailureClusters } from '../lib/failure-clustering/index.js';
import {
  SubmitProjectSummaryRequestSchema,
  SubmitReportSummaryRequestSchema,
  SubmitTestAnalysisRequestSchema,
} from '../lib/schemas/index.js';
import { analysisFeedbackDb } from '../lib/service/db/analysisFeedback.sqlite.js';
import { failureSummaryDb } from '../lib/service/db/failureSummary.sqlite.js';
import { llmTasksDb } from '../lib/service/db/llmTasks.sqlite.js';
import { projectSummaryDb } from '../lib/service/db/projectSummary.sqlite.js';
import { regressionsDb } from '../lib/service/db/regressions.sqlite.js';
import { reportDb } from '../lib/service/db/reports.sqlite.js';
import { testAnalysisDb } from '../lib/service/db/testAnalysis.sqlite.js';
import { testDb } from '../lib/service/db/tests.sqlite.js';
import { service } from '../lib/service/index.js';
import { buildTestAnalysisRequest } from '../lib/service/llmAnalysisQueue.js';
import { testManagementService } from '../lib/service/testManagement.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

const FAILED_TESTS_PER_REPORT_MAX = 50;
const FAILED_OUTCOMES = new Set(['unexpected', 'failed', 'flaky']);

interface FailureLocation {
  file: string;
  line: number;
  column?: number;
}

type NormalizedOutcome = 'passed' | 'failed' | 'flaky' | 'skipped';

function normalizeOutcome(raw: string): NormalizedOutcome {
  if (raw === 'expected' || raw === 'passed') return 'passed';
  if (raw === 'unexpected' || raw === 'failed') return 'failed';
  if (raw === 'flaky') return 'flaky';
  return 'skipped';
}

type FlakyTier = 'stable' | 'flaky' | 'critical';

const CLUSTER_OTHER_TESTS_MAX = 5;

interface TestBrief {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  signals: {
    quarantined: boolean;
    /** Flakiness percent (0–100). Compare against thresholds via `flakyTier`. */
    flakinessScore: number;
    /**
     * Derived classification from `flakinessScore` and the active site config
     * thresholds (warningThresholdPercentage / quarantineThresholdPercentage).
     * - `stable` — below warning threshold (worth ignoring)
     * - `flaky` — between warning and quarantine (worth flagging)
     * - `critical` — at or above quarantine threshold (worth fixing now)
     */
    flakyTier: FlakyTier;
    /** Count of prior runs sharing the same `latestFailure.signature`. */
    signatureOccurrenceCount: number;
    /** Timestamp this `signature` first appeared (not the test's first run). */
    signatureFirstSeen?: string;
  };
  latestFailure: {
    error: string;
    category?: string;
    signature?: string;
    location?: FailureLocation;
    appFrame?: string;
    reportId: string;
    reportUrl?: string;
    createdAt: string;
    attachments?: {
      screenshotUrl?: string;
      errorContextUrl?: string;
    };
  } | null;
  llmAnalysis: {
    rootCause: string;
    fix: string;
    model?: string;
  } | null;
  feedback: {
    comment: string;
    updatedAt: string;
  } | null;
  cluster: {
    id: string;
    kind: ClusterAnchor['kind'];
    name: string;
    sampleError: string;
    otherTests: Array<{ testId: string; fileId: string; project: string; title: string }>;
    /** Total member count including the current test. Use `cluster brief <id>`
     *  when the cluster has more members than `otherTests` (capped). */
    otherTestsTotal: number;
    otherTestsTruncated: boolean;
  } | null;
  regression: {
    id: string;
    regressedAtReportId: string;
    regressedAtDisplayNumber: number | null;
    regressedAtCreatedAt: string;
    regressedAtCommit: string | null;
    regressedAtCategory: string | null;
    lastGreenReportId: string | null;
    lastGreenDisplayNumber: number | null;
    lastGreenCreatedAt: string | null;
    lastGreenCommit: string | null;
    daysOpen: number;
    failureCount: number;
    flakyCount: number;
  } | null;
}

interface ReportBriefSummaryEntry {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  category?: string;
  errorFirstLine?: string;
}

interface ReportBriefCluster {
  id: string;
  kind: ClusterAnchor['kind'];
  name: string;
  sampleError: string;
  testCount: number;
  testIds: string[];
  /** Top-N representative failures in this cluster, always populated. */
  sampleFailedTests: ReportBriefSummaryEntry[];
}

interface ReportBriefBase {
  reportId: string;
  displayNumber?: number;
  title?: string;
  project: string;
  createdAt: string;
  reportUrl: string;
  stats: { total: number; passed: number; failed: number; flaky: number; skipped: number };
  clusterSummary: ReportBriefCluster[];
  unclusteredFailures: number;
  failedTestsTruncated: boolean;
  regressions: { newHere: number; resolvedHere: number } | null;
}

// Discriminated by `mode` so the agent can statically pick the right payload
// arm. Summary keeps payloads ~5 KB; full mode escalates to every failure's
// brief and is intended for ~25-failure iterations.
type ReportBrief =
  | (ReportBriefBase & {
      mode: 'summary';
      sampleUnclusteredFailures: ReportBriefSummaryEntry[];
    })
  | (ReportBriefBase & {
      mode: 'full';
      failedTests: TestBrief[];
    });

export async function registerCliRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(async (api) => {
    api.addHook('preHandler', (request, reply) => authenticate(request as AuthRequest, reply));

    // GET /api/cli/test/:testId/brief?project=...
    // One-shot "everything we know about this test" payload for an agent.
    // `project` is optional — when omitted the server resolves the canonical
    // (fileId, project) lane from the test's most recent run.
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

    // GET /api/cli/test/:testId/analysis?project=...
    // Full persisted LLM analysis (the raw markdown). `test brief` returns a
    // heuristic rootCause/fix split — use this when the agent wants the
    // unmodified document or the regex split lost a section.
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

    // GET /api/cli/test/:testId/failure-context?project=&reportId=
    // Fresh would-be prompt + typed evidence envelope. Same builder the queue
    // uses. Agents wanting a different layout can render from `evidence`.
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

    // GET /api/cli/test/:testId/analysis-prompt?reportId=...[&taskId=...]
    // The *historical* prompt: returns the verbatim text we sent on the latest
    // completed `test_analysis` task for this (testId, reportId). Mirrors the
    // in-report widget's "Copy prompt" button. 404 when no task exists.
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

    // GET /api/cli/test/:testId/history?project=...&limit=N
    // Compact per-run history. Same identifier-resolution rules as `brief`.
    // Default limit 20; max 50 (matches the underlying getTestRuns cap).
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

    // GET /api/cli/report/:id/brief?mode=summary|full
    // The 25-failures-iteration entry point: returns metadata, cluster
    // grouping for the failed tests, and (in `full` mode) a brief per failure.
    // Summary mode is the default — it returns stats + clusterSummary +
    // sampleFailedTests (top 3 per cluster) and keeps payloads ~5 KB even for
    // a 50-failure report. Pass `mode=full` (or `--with-failures` from the
    // CLI) to get every failed test's full brief.
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

    // GET /api/cli/cluster/:id/brief?project=...
    // Drill into a single failure cluster: same shape returned in
    // clusterSummary, plus every member test's brief (capped). Useful when an
    // agent finds a cluster in `cluster list` or `report brief` and wants the
    // full failure context for every member at once.
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

    // GET /api/cli/report/:id/summary
    // Persisted LLM failure summary for a single report (the same payload the
    // "Summarize Failures" button shows in the UI). Returns 404 when no
    // summary has been generated yet, so agents can distinguish "nothing yet"
    // from "no failures in this report".
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

    // GET /api/cli/project/:project/summary
    // Persisted LLM project summary (same payload powering the dashboard
    // "Project Health" card). Use 'all' to query the cross-project summary.
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

    // GET /api/cli/report/resolve?displayNumber=479&project=...
    // Resolve a human-friendly displayNumber (the `#479` an agent sees in CI)
    // to the UUID reportId that `report compare` / `report brief` accept.
    // Returns matches (most-recent first) so the agent can disambiguate if the
    // same displayNumber exists across multiple projects.
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
      // Cap to a sane upper bound — the from-file scorer evaluates ~limit*4
      // candidates (default limit 10 → 40 testIds).
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
      const openFilter =
        active === 'true' ? true : resolved === 'true' ? false : undefined;
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

    // GET /api/cli/categories?project=...
    // Enumerate the failure categories the heuristic has emitted, so agents
    // can pick a valid value for `test search --failure-category`. Pass
    // `project=<p>` to scope to a single project (categories may differ).
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
          lastReportId: body.lastReportId ?? existing?.lastReportId ?? undefined,
          reportCount: body.reportCount ?? existing?.reportCount ?? undefined,
          firstReportAt: body.firstReportAt ?? existing?.firstReportAt ?? undefined,
          lastReportAt: body.lastReportAt ?? existing?.lastReportAt ?? undefined,
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

function resolveTestRun(
  testId: string,
  reportId: string
): { fileId: string; project: string } | null {
  const runs = testDb.getTestRunsByReport(reportId);
  const run = runs.find((r) => r.testId === testId);
  if (!run) return null;
  return { fileId: run.fileId, project: run.project };
}

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

/**
 * Resolve a testId (and optional project filter) to the canonical
 * (testId, fileId, project) lane. The CLI surface only carries testId in the
 * URL — fileId is derived here from the test's most recent run, so the agent
 * doesn't have to track a second opaque ID.
 */
function resolveTestIdentity(
  testId: string,
  project: string | undefined
): { testId: string; fileId: string; project: string } | null {
  const row = testDb.findRunLane(testId, project);
  if (!row) return null;
  return { testId, fileId: row.fileId, project: row.project };
}

async function buildTestBrief(
  testId: string,
  fileId: string,
  project: string,
  preFetchedClusters?: Awaited<ReturnType<typeof getFailureClusters>>,
  preFetchedThresholds?: { warning: number; quarantine: number }
): Promise<TestBrief | null> {
  const detail = await testManagementService.getTestDetail(testId, fileId, project);
  if (!detail) return null;

  const latestFailedRun = detail.runs.find((r) => FAILED_OUTCOMES.has(r.outcome));
  const parsed = latestFailedRun ? parseFailureDetails(latestFailedRun.failureDetails) : undefined;

  const history =
    latestFailedRun?.errorSignature && latestFailedRun.errorSignature.length > 0
      ? testDb.getFailureHistory(
          testId,
          fileId,
          latestFailedRun.errorSignature,
          '' // include the current report — we want the full count
        )
      : { priorOccurrenceCount: 0, firstOccurrence: null };

  const analysisRow = testAnalysisDb.getByTest(testId, fileId, project);
  const feedbackRow = analysisFeedbackDb.getByTest(testId, fileId, project);

  const thresholds = preFetchedThresholds ?? (await getFlakinessThresholds());
  const roundedScore = Math.round((detail.flakinessScore ?? 0) * 10) / 10;

  // Reuse the cluster report passed by `buildReportBrief` when present —
  const clusterReport = preFetchedClusters ?? (await getFailureClusters({ project }));
  const containing = clusterReport.clusters.find((c) =>
    c.tests.some((t) => t.testId === testId && t.fileId === fileId && t.project === project)
  );

  return {
    testId: detail.testId,
    fileId: detail.fileId,
    project: detail.project,
    title: detail.title,
    filePath: detail.filePath,
    signals: {
      quarantined: detail.isQuarantined,
      // One-decimal precision is enough for an agent's purposes; rounding here
      // means callers don't need to (and the CLI no longer double-rounds).
      // Value is a percent in [0, 100].
      flakinessScore: roundedScore,
      flakyTier: classifyFlakyTier(roundedScore, thresholds),
      signatureOccurrenceCount: history.priorOccurrenceCount,
      signatureFirstSeen: history.firstOccurrence?.createdAt,
    },
    latestFailure: latestFailedRun
      ? (() => {
          const reportRow = reportDb.getByID(latestFailedRun.reportId);
          return {
            error: parsed?.message ?? '',
            category: latestFailedRun.failureCategory ?? undefined,
            signature: latestFailedRun.errorSignature ?? undefined,
            location: parsed?.location
              ? {
                  file: parsed.location.file,
                  line: parsed.location.line,
                  column: parsed.location.column,
                }
              : undefined,
            appFrame: parsed ? extractFrameFromFailure(parsed) : undefined,
            reportId: latestFailedRun.reportId,
            reportUrl: reportRow?.reportUrl,
            createdAt: latestFailedRun.createdAt,
            attachments: buildAttachmentUrls(reportRow?.reportUrl, parsed?.attachments),
          };
        })()
      : null,
    llmAnalysis: analysisRow?.analysis
      ? {
          rootCause: extractSection(analysisRow.analysis, /root cause/i) ?? analysisRow.analysis,
          fix: extractSection(analysisRow.analysis, /fix|best practice|solution/i) ?? '',
          model: analysisRow.model ?? undefined,
        }
      : null,
    feedback: feedbackRow
      ? { comment: feedbackRow.comment, updatedAt: feedbackRow.updatedAt }
      : null,
    cluster: containing
      ? (() => {
          const others = containing.tests.filter((t) => t.testId !== testId || t.fileId !== fileId);
          return {
            id: containing.id,
            kind: containing.anchor.kind,
            name: containing.name,
            sampleError: containing.sampleMessage,
            otherTests: others.slice(0, CLUSTER_OTHER_TESTS_MAX).map((t) => ({
              testId: t.testId,
              fileId: t.fileId,
              project: t.project,
              title: t.title,
            })),
            otherTestsTotal: others.length,
            otherTestsTruncated: others.length > CLUSTER_OTHER_TESTS_MAX,
          };
        })()
      : null,
    regression: (() => {
      const reg = regressionsDb.getOpenForTest(testId, fileId, project);
      if (!reg) return null;
      return {
        id: reg.id,
        regressedAtReportId: reg.regressedAtReportId,
        regressedAtDisplayNumber: reg.regressedAtDisplayNumber,
        regressedAtCreatedAt: reg.regressedAtCreatedAt,
        regressedAtCommit: reg.regressedAtCommit,
        regressedAtCategory: reg.regressedAtCategory,
        lastGreenReportId: reg.lastGreenReportId,
        lastGreenDisplayNumber: reg.lastGreenDisplayNumber,
        lastGreenCreatedAt: reg.lastGreenCreatedAt,
        lastGreenCommit: reg.lastGreenCommit,
        daysOpen: Math.round(reg.daysOpen * 10) / 10,
        failureCount: reg.failureCount,
        flakyCount: reg.flakyCount,
      };
    })(),
  };
}

const SAMPLE_FAILED_TESTS_PER_CLUSTER = 3;
const SAMPLE_UNCLUSTERED_FAILURES = 5;
const ERROR_FIRST_LINE_MAX_CHARS = 240;

/**
 * Resolve the active flakiness thresholds. `service.getConfig()` is cached
 * in-memory by `configCache`, so calling this per brief is cheap. Both
 * thresholds fall back to the same defaults used by `testManagement.ts` so
 * the tier classification matches the dashboard's tier filter.
 */
async function getFlakinessThresholds(): Promise<{ warning: number; quarantine: number }> {
  const config = await service.getConfig();
  const tm = config?.testManagement ?? {};
  return {
    warning:
      tm.warningThresholdPercentage ??
      defaultConfig.testManagement?.warningThresholdPercentage ??
      2,
    quarantine:
      tm.quarantineThresholdPercentage ??
      defaultConfig.testManagement?.quarantineThresholdPercentage ??
      5,
  };
}

function classifyFlakyTier(
  score: number,
  thresholds: { warning: number; quarantine: number }
): FlakyTier {
  if (score >= thresholds.quarantine) return 'critical';
  if (score >= thresholds.warning) return 'flaky';
  return 'stable';
}

async function buildReportBrief(reportId: string, full: boolean): Promise<ReportBrief | null> {
  const report = reportDb.getByID(reportId);
  if (!report) return null;

  const failedTestRefs = testDb
    .getTestRunsByReport(reportId)
    .filter((run) => FAILED_OUTCOMES.has(run.outcome))
    .map((run) => ({ testId: run.testId, fileId: run.fileId, project: run.project }));

  const truncated = failedTestRefs.length > FAILED_TESTS_PER_REPORT_MAX;
  const refsToBrief = failedTestRefs.slice(0, FAILED_TESTS_PER_REPORT_MAX);

  // Pull cluster data once for the report's project — getFailureClusters has
  // a 60s in-memory cache so even when called per-test below it stays cheap,
  // but going through the report's project up front is the safe path.
  const clusterReport = await getFailureClusters({ project: report.project });
  const thresholds = await getFlakinessThresholds();

  const briefs: TestBrief[] = [];
  for (const ref of refsToBrief) {
    const brief = await buildTestBrief(
      ref.testId,
      ref.fileId,
      ref.project,
      clusterReport,
      thresholds
    );
    if (brief) briefs.push(brief);
  }

  // Roll up cluster membership across the report's failed tests so the agent
  // can fix the root cause once instead of iterating per-test.
  const clusterIdToFailedBriefs = new Map<string, TestBrief[]>();
  for (const brief of briefs) {
    if (!brief.cluster) continue;
    const list = clusterIdToFailedBriefs.get(brief.cluster.id) ?? [];
    list.push(brief);
    clusterIdToFailedBriefs.set(brief.cluster.id, list);
  }
  // sampleFailedTests is always populated — useful in both modes as a skim view
  // of who's in each cluster, even when `failedTests` is also present.
  const clusterSummary: ReportBriefCluster[] = [...clusterIdToFailedBriefs.entries()]
    .map(([id, members]): ReportBriefCluster | null => {
      const cluster = clusterReport.clusters.find((c) => c.id === id);
      if (!cluster) return null;
      return {
        id,
        kind: cluster.anchor.kind,
        name: cluster.name,
        sampleError: cluster.sampleMessage,
        testCount: members.length,
        testIds: members.map((m) => m.testId),
        sampleFailedTests: members
          .slice(0, SAMPLE_FAILED_TESTS_PER_CLUSTER)
          .map(briefToSummaryEntry),
      };
    })
    .filter((c): c is ReportBriefCluster => c !== null)
    .sort((a, b) => b.testCount - a.testCount);

  const unclustered = briefs.filter((b) => !b.cluster);
  const unclusteredFailures = unclustered.length;

  const regressionCounts = regressionsDb.countsForReport(report.reportID);
  const base: ReportBriefBase = {
    reportId: report.reportID,
    displayNumber: report.displayNumber,
    title: report.title,
    project: report.project,
    createdAt:
      report.createdAt instanceof Date ? report.createdAt.toISOString() : String(report.createdAt),
    reportUrl: report.reportUrl,
    stats: {
      total: report.stats?.total ?? 0,
      passed: report.stats?.expected ?? 0,
      failed: report.stats?.unexpected ?? 0,
      flaky: report.stats?.flaky ?? 0,
      skipped: report.stats?.skipped ?? 0,
    },
    clusterSummary,
    unclusteredFailures,
    failedTestsTruncated: truncated,
    regressions:
      regressionCounts.newHere === 0 && regressionCounts.resolvedHere === 0
        ? null
        : regressionCounts,
  };

  if (full) {
    return { ...base, mode: 'full', failedTests: briefs };
  }
  // Compact mode: a handful of unclustered failures sampled — every clustered
  // failure is already represented via the cluster summary's `sampleFailedTests`.
  return {
    ...base,
    mode: 'summary',
    sampleUnclusteredFailures: unclustered
      .slice(0, SAMPLE_UNCLUSTERED_FAILURES)
      .map(briefToSummaryEntry),
  };
}

function briefToSummaryEntry(brief: TestBrief) {
  return {
    testId: brief.testId,
    fileId: brief.fileId,
    project: brief.project,
    title: brief.title,
    filePath: brief.filePath,
    category: brief.latestFailure?.category,
    errorFirstLine: firstNonEmptyLine(brief.latestFailure?.error),
  };
}

function firstNonEmptyLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length > 0) return line.slice(0, ERROR_FIRST_LINE_MAX_CHARS);
  }
  return undefined;
}

interface TestHistoryRun {
  reportId: string;
  reportDisplayNumber?: number;
  reportTitle?: string;
  outcome: NormalizedOutcome;
  durationMs?: number;
  errorSignature?: string;
  category?: string;
  createdAt: string;
}

interface TestHistory {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  totalReturned: number;
  appliedLimit: number;
  /** True when the caller-requested limit exceeded MAX_HISTORY_LIMIT. */
  limitClamped: boolean;
  hasMore: boolean;
  stats: {
    runs: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
  };
  signatureGroups: Array<{
    signature: string;
    category?: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
  }>;
  runs: TestHistoryRun[];
}

async function buildTestHistory(
  testId: string,
  fileId: string,
  project: string,
  limit: number,
  requestedLimit: number
): Promise<TestHistory | null> {
  const test = await testManagementService.getTest(testId, fileId, project);
  if (!test) return null;
  // getTestRuns is hard-capped at the 50 most-recent rows.
  const runs = testDb.getTestRuns(testId, fileId, project);
  const sliced = runs.slice(0, limit);

  const stats = { runs: runs.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const r of runs) {
    if (r.outcome === 'expected' || r.outcome === 'passed') stats.passed++;
    else if (r.outcome === 'unexpected' || r.outcome === 'failed') stats.failed++;
    else if (r.outcome === 'flaky') stats.flaky++;
    else if (r.outcome === 'skipped') stats.skipped++;
  }

  // Roll up by signature so the agent sees "this test failed the same way 6
  // times, then a new signature appeared yesterday" without scanning every row.
  const groupKey = (sig?: string) => (sig && sig.length > 0 ? sig : '__no_signature__');
  const groups = new Map<
    string,
    { signature: string; category?: string; count: number; firstSeen: string; lastSeen: string }
  >();
  for (const r of runs) {
    if (!FAILED_OUTCOMES.has(r.outcome)) continue;
    const key = groupKey(r.errorSignature);
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (r.createdAt < existing.firstSeen) existing.firstSeen = r.createdAt;
      if (r.createdAt > existing.lastSeen) existing.lastSeen = r.createdAt;
      if (!existing.category && r.failureCategory) existing.category = r.failureCategory;
    } else {
      groups.set(key, {
        signature: r.errorSignature ?? '',
        category: r.failureCategory,
        count: 1,
        firstSeen: r.createdAt,
        lastSeen: r.createdAt,
      });
    }
  }
  const signatureGroups = [...groups.values()].sort((a, b) => b.count - a.count);

  return {
    testId: test.testId,
    fileId: test.fileId,
    project: test.project,
    title: test.title,
    filePath: test.filePath,
    totalReturned: sliced.length,
    appliedLimit: limit,
    limitClamped: requestedLimit !== limit,
    hasMore: runs.length > sliced.length,
    stats,
    signatureGroups,
    runs: sliced.map((r) => ({
      reportId: r.reportId,
      reportDisplayNumber: r.reportDisplayNumber,
      reportTitle: r.reportTitle,
      outcome: normalizeOutcome(r.outcome),
      durationMs: r.duration,
      errorSignature: r.errorSignature,
      category: r.failureCategory,
      createdAt: r.createdAt,
    })),
  };
}

interface ClusterBrief {
  cluster: {
    id: string;
    kind: ClusterAnchor['kind'];
    name: string;
    sampleError: string;
    category?: string;
    confidence: 'high' | 'medium' | 'low';
    testCount: number;
    failureCount: number;
    anchor: ClusterAnchor;
  };
  members: TestBrief[];
  membersTruncated: boolean;
  regressionContext: ClusterRegressionContext | null;
}

async function buildClusterBrief(
  clusterId: string,
  project: string | undefined
): Promise<ClusterBrief | null> {
  const tryProjects: Array<string | undefined> = project ? [project, undefined] : [undefined];
  let cluster: Awaited<ReturnType<typeof getFailureClusters>>['clusters'][number] | undefined;
  let report: Awaited<ReturnType<typeof getFailureClusters>> | undefined;
  for (const p of tryProjects) {
    const candidate = await getFailureClusters({ project: p });
    const found = candidate.clusters.find((c) => c.id === clusterId);
    if (found) {
      cluster = found;
      report = candidate;
      break;
    }
  }
  if (!cluster || !report) return null;

  const refsToBrief = cluster.tests.slice(0, FAILED_TESTS_PER_REPORT_MAX);
  const truncated = cluster.tests.length > refsToBrief.length;
  const thresholds = await getFlakinessThresholds();

  const members: TestBrief[] = [];
  for (const t of refsToBrief) {
    const brief = await buildTestBrief(t.testId, t.fileId, t.project, report, thresholds);
    if (brief) members.push(brief);
  }

  return {
    cluster: {
      id: cluster.id,
      kind: cluster.anchor.kind,
      name: cluster.name,
      sampleError: cluster.sampleMessage,
      category: cluster.category,
      confidence: cluster.confidence,
      testCount: cluster.testCount,
      failureCount: cluster.failureCount,
      anchor: cluster.anchor,
    },
    members,
    membersTruncated: truncated,
    regressionContext: cluster.regressionContext ?? null,
  };
}

async function buildReportSummary(reportId: string) {
  const report = reportDb.getByID(reportId);
  if (!report) return null;
  const summary = failureSummaryDb.getSummary(reportId);
  const runs = testDb.getTestRunsByReport(reportId);
  const hasFailures = runs.some((r) => FAILED_OUTCOMES.has(r.outcome));
  const regressions = regressionsDb.countsForReport(reportId);
  return {
    reportId,
    project: report.project,
    displayNumber: report.displayNumber,
    hasFailures,
    summary: summary ?? null,
    regressions: regressions.newHere === 0 && regressions.resolvedHere === 0 ? null : regressions,
  };
}

async function buildProjectSummary(projectKey: string) {
  const row = projectSummaryDb.get(projectKey);
  let structured: unknown = null;
  if (row?.structured) {
    try {
      structured = JSON.parse(row.structured);
    } catch {
      // tolerate stale JSON — agent gets the prose summary either way
    }
  }
  return {
    project: projectKey,
    summary: row
      ? {
          summary: row.summary,
          structured,
          model: row.model,
          lastReportId: row.lastReportId,
          reportCount: row.reportCount,
          firstReportAt: row.firstReportAt,
          lastReportAt: row.lastReportAt,
          updatedAt: row.updatedAt,
        }
      : null,
  };
}

async function buildTestAnalysis(testId: string, fileId: string, project: string) {
  const row = testAnalysisDb.getByTest(testId, fileId, project);
  return {
    testId,
    fileId,
    project,
    analysis: row?.analysis ?? null,
    model: row?.model ?? null,
    category: row?.category ?? null,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

async function buildReportResolve(displayNumber: number, project?: string) {
  const rows = reportDb.findByDisplayNumber(displayNumber, project);
  return rows.map((r) => ({
    reportId: r.reportID,
    project: r.project,
    title: r.title ?? undefined,
    displayNumber: r.displayNumber ?? displayNumber,
    createdAt: r.createdAt,
    reportUrl: r.reportUrl,
  }));
}

async function buildFailureCategories(project?: string) {
  return testDb.getFailureCategoryCounts(project);
}

function buildAttachmentUrls(
  reportUrl: string | undefined,
  attachments: { name: string; path: string; contentType: string }[] | undefined
): { screenshotUrl?: string; errorContextUrl?: string } | undefined {
  if (!reportUrl || !attachments || attachments.length === 0) return undefined;
  const base = reportUrl.replace(/index\.html$/, '');
  let screenshotUrl: string | undefined;
  let errorContextUrl: string | undefined;
  for (const att of attachments) {
    if (!att?.path) continue;
    if (!screenshotUrl && att.name === 'screenshot' && att.contentType?.startsWith('image/')) {
      screenshotUrl = `${base}${att.path}`;
    } else if (!errorContextUrl && att.name === 'error-context') {
      errorContextUrl = `${base}${att.path}`;
    }
  }
  if (!screenshotUrl && !errorContextUrl) return undefined;
  return { screenshotUrl, errorContextUrl };
}

/**
 * The persisted LLM analysis is markdown with section headers like
 * "## 🔍 Root Cause" / "## 🛠️ Fix". Pull the first paragraph after a header
 * matching `pattern`. Returns undefined if no header matches.
 */
function extractSection(markdown: string, pattern: RegExp): string | undefined {
  const lines = markdown.split('\n');
  let capturing = false;
  const captured: string[] = [];
  for (const line of lines) {
    const isHeader = /^#{1,4}\s/.test(line);
    if (isHeader) {
      if (capturing) break;
      const headerText = line.replace(/^#+\s*/, '');
      if (pattern.test(headerText)) capturing = true;
      continue;
    }
    if (capturing) captured.push(line);
  }
  const text = captured.join('\n').trim();
  return text.length > 0 ? text : undefined;
}
