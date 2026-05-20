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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseFailureDetails } from '../lib/failure-clustering/extractors/failure-details.js';
import { extractAppCodeFrame } from '../lib/failure-clustering/extractors/stack-trace.js';
import { getFailureClusters } from '../lib/failure-clustering/index.js';
import { analysisFeedbackDb } from '../lib/service/db/analysisFeedback.sqlite.js';
import { reportDb } from '../lib/service/db/reports.sqlite.js';
import { testAnalysisDb } from '../lib/service/db/testAnalysis.sqlite.js';
import { testDb } from '../lib/service/db/tests.sqlite.js';
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

interface TestBrief {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  signals: {
    quarantined: boolean;
    flakinessScore: number;
    occurrenceCount: number;
    firstSeen?: string;
    isClustered: boolean;
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
    strategy: string;
    name: string;
    sampleError: string;
    otherTests: Array<{ testId: string; fileId: string; project: string; title: string }>;
  } | null;
}

interface ReportBrief {
  reportId: string;
  displayNumber?: number;
  title?: string;
  project: string;
  createdAt: string;
  reportUrl: string;
  stats: { total: number; passed: number; failed: number; flaky: number; skipped: number };
  clusterSummary: Array<{
    id: string;
    strategy: string;
    name: string;
    sampleError: string;
    testCount: number;
    testIds: string[];
  }>;
  unclusteredFailures: number;
  failedTestsTruncated: boolean;
  failedTests: TestBrief[];
}

export async function registerCliRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(async (api) => {
    api.addHook('preHandler', (request, reply) => authenticate(request as AuthRequest, reply));

    // GET /api/cli/test/:fileId/:testId/brief?project=...
    // One-shot "everything we know about this test" payload for an agent.
    api.get(
      '/api/cli/test/:fileId/:testId/brief',
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { fileId, testId } = request.params as { fileId: string; testId: string };
        const { project } = request.query as { project?: string };
        if (!project) {
          return reply
            .status(400)
            .send({ success: false, error: 'project query parameter is required' });
        }
        const { result: brief, error } = await withError(buildTestBrief(testId, fileId, project));
        if (error) {
          fastify.log.error(error);
          return reply.status(500).send({ success: false, error: 'Failed to build test brief' });
        }
        if (!brief) {
          return reply.status(404).send({ success: false, error: 'Test not found' });
        }
        return reply.send({ success: true, data: brief });
      }
    );

    // GET /api/cli/report/:id/brief
    // The 25-failures-iteration entry point: returns metadata, cluster
    // grouping for the failed tests, and a brief per failure (capped).
    api.get('/api/cli/report/:id/brief', async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { result: brief, error } = await withError(buildReportBrief(id));
      if (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to build report brief' });
      }
      if (!brief) {
        return reply.status(404).send({ success: false, error: 'Report not found' });
      }
      return reply.send({ success: true, data: brief });
    });
  });
}

async function buildTestBrief(
  testId: string,
  fileId: string,
  project: string,
  preFetchedClusters?: Awaited<ReturnType<typeof getFailureClusters>>
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
          project,
          latestFailedRun.errorSignature,
          '' // include the current report — we want the full count
        )
      : { priorOccurrenceCount: 0, firstOccurrence: null };

  const analysisRow = testAnalysisDb.getByTest(testId, fileId, project);
  const feedbackRow = analysisFeedbackDb.getByTest(testId, fileId, project);

  // Reuse the cluster report passed by `buildReportBrief` when present —
  // saves a per-test Map lookup when briefing every failure in a report.
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
      flakinessScore: Math.round((detail.flakinessScore ?? 0) * 10) / 10,
      occurrenceCount: history.priorOccurrenceCount,
      firstSeen: history.firstOccurrence?.createdAt,
      isClustered: Boolean(containing),
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
            appFrame: extractAppCodeFrame(parsed?.stackTrace),
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
      ? {
          id: containing.id,
          strategy: containing.strategy,
          name: containing.name,
          sampleError: containing.sampleMessage,
          otherTests: containing.tests
            .filter((t) => t.testId !== testId || t.fileId !== fileId)
            .map((t) => ({
              testId: t.testId,
              fileId: t.fileId,
              project: t.project,
              title: t.title,
            })),
        }
      : null,
  };
}

async function buildReportBrief(reportId: string): Promise<ReportBrief | null> {
  const report = reportDb.getByID(reportId);
  if (!report) return null;

  const failedTestRefs: Array<{ testId: string; fileId: string; project: string }> = [];
  for (const file of report.files ?? []) {
    for (const test of file.tests ?? []) {
      if (FAILED_OUTCOMES.has(test.outcome)) {
        failedTestRefs.push({ testId: test.testId, fileId: file.fileId, project: report.project });
      }
    }
  }

  const truncated = failedTestRefs.length > FAILED_TESTS_PER_REPORT_MAX;
  const refsToBrief = failedTestRefs.slice(0, FAILED_TESTS_PER_REPORT_MAX);

  // Pull cluster data once for the report's project — getFailureClusters has
  // a 60s in-memory cache so even when called per-test below it stays cheap,
  // but going through the report's project up front is the safe path.
  const clusterReport = await getFailureClusters({ project: report.project });

  const briefs: TestBrief[] = [];
  for (const ref of refsToBrief) {
    const brief = await buildTestBrief(ref.testId, ref.fileId, ref.project, clusterReport);
    if (brief) briefs.push(brief);
  }

  // Roll up cluster membership across the report's failed tests so the agent
  // can fix the root cause once instead of iterating per-test.
  const clusterIdToFailedTestIds = new Map<string, Set<string>>();
  for (const brief of briefs) {
    if (!brief.cluster) continue;
    const set = clusterIdToFailedTestIds.get(brief.cluster.id) ?? new Set<string>();
    set.add(brief.testId);
    clusterIdToFailedTestIds.set(brief.cluster.id, set);
  }
  const clusterSummary = [...clusterIdToFailedTestIds.entries()]
    .map(([id, testIds]) => {
      const cluster = clusterReport.clusters.find((c) => c.id === id);
      if (!cluster) return null;
      return {
        id,
        strategy: cluster.strategy,
        name: cluster.name,
        sampleError: cluster.sampleMessage,
        testCount: testIds.size,
        testIds: [...testIds],
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => b.testCount - a.testCount);

  const unclusteredFailures = briefs.filter((b) => !b.cluster).length;

  return {
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
    failedTests: briefs,
  };
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
