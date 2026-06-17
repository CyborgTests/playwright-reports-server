import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { llmService } from '../lib/llm/index.js';
import {
  MANUAL_PROJECT_SUMMARY_PRIORITY,
  PROJECT_SUMMARY_REPORT_LIMIT,
} from '../lib/llm/queue/index.js';
import { analyticsService } from '../lib/service/analytics.js';
import { llmTasksDb, projectSummaryDb, reportDb } from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

const STALENESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/analytics', async (request, reply) => {
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
    const { result: analyticsData, error } = await withError(
      analyticsService.getAnalyticsData(project, from, to, failedOnlyFlag)
    );

    if (error) {
      return reply.status(500).send({
        success: false,
        error: `Failed to fetch analytics data: ${error.message}`,
      });
    }

    return { success: true, data: analyticsData };
  });

  fastify.get('/api/analytics/run-health', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const {
      project = 'all',
      from,
      to,
      failedOnly,
      before,
      limit,
    } = request.query as {
      project?: string;
      from?: string;
      to?: string;
      failedOnly?: string;
      before?: string;
      limit?: string;
    };
    const failedOnlyFlag = failedOnly === 'true' || failedOnly === '1';
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;
    const pageLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;

    const { result: metrics, error } = await withError(
      analyticsService.getRunHealthPage(project, {
        from,
        to,
        failedOnly: failedOnlyFlag,
        before,
        limit: pageLimit,
      })
    );

    if (error) {
      return reply.status(500).send({
        success: false,
        error: `Failed to fetch run health: ${error.message}`,
      });
    }

    return { success: true, data: { metrics, hasMore: (metrics?.length ?? 0) >= pageLimit } };
  });

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

        let isStale = false;
        let isTooStale = false;
        let currentLatestReportAt: string | undefined;
        if (row?.lastReportAt) {
          const [currentLatest] = reportDb.getLatestByProject(
            projectKey === 'all' ? undefined : projectKey,
            1
          );
          if (currentLatest?.createdAt) {
            currentLatestReportAt = String(currentLatest.createdAt);
            const cachedAt = new Date(row.lastReportAt).getTime();
            const currentAt = new Date(currentLatestReportAt).getTime();
            if (Number.isFinite(cachedAt) && Number.isFinite(currentAt) && currentAt > cachedAt) {
              isStale = true;
              isTooStale = currentAt - cachedAt >= STALENESS_MAX_AGE_MS;
            }
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
              isStale,
              isTooStale,
              currentLatestReportAt,
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
            .slice(0, PROJECT_SUMMARY_REPORT_LIMIT);
        } else {
          latestReports = reportDb.getLatestByProject(
            project || undefined,
            PROJECT_SUMMARY_REPORT_LIMIT
          );
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

        const projectConfig = await service.getConfig();
        const analyzeGreen = projectConfig.llm?.analyzeGreenWindows === true;

        if (!hasAnyFailures && !analyzeGreen) {
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

        const inflight = llmTasksDb.findInflightProjectSummary(projectKey);

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
            priority: MANUAL_PROJECT_SUMMARY_PRIORITY,
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
}
