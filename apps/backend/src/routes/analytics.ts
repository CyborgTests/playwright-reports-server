import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { llmService } from '../lib/llm/index.js';
import {
  MANUAL_PROJECT_SUMMARY_PRIORITY,
  PROJECT_SUMMARY_REPORT_LIMIT,
} from '../lib/llm/queue/index.js';
import { getProjectEtaFinishAt } from '../lib/llm/queueEta.js';
import { analyticsService } from '../lib/service/analytics.js';
import { failureSummaryDb } from '../lib/service/db/failureSummary.sqlite.js';
import { llmTasksDb, projectSummaryDb, reportDb } from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { withError } from '../lib/withError.js';
import { authorize } from './auth.js';

const STALENESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const analyticsAuthErrorSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
};

const analyticsErrorSchema = {
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { type: 'string' },
  },
};

const statDeltaSchema = {
  type: 'object',
  required: ['percent', 'trend'],
  properties: {
    percent: { type: 'number', nullable: true },
    trend: { type: 'string', enum: ['up', 'down', 'stable'] },
  },
};

const overviewStatsSchema = {
  type: 'object',
  required: [
    'totalTests',
    'totalRuns',
    'passRate',
    'averageTestDuration',
    'averageTestRunDuration',
    'passRateTrend',
    'flakyTestsTrend',
  ],
  properties: {
    totalTests: { type: 'integer' },
    totalRuns: { type: 'integer' },
    passRate: { type: 'number' },
    averageTestDuration: { type: 'number' },
    averageTestRunDuration: { type: 'number' },
    passRateTrend: { type: 'string', enum: ['up', 'down', 'stable'] },
    flakyTestsTrend: { type: 'string', enum: ['up', 'down', 'stable'] },
    deltas: {
      type: 'object',
      properties: {
        passRate: statDeltaSchema,
        flakyTests: statDeltaSchema,
        averageTestDuration: statDeltaSchema,
        averageTestRunDuration: statDeltaSchema,
      },
    },
  },
};

const runHealthMetricSchema = {
  type: 'object',
  required: ['runId', 'timestamp', 'totalTests', 'passed', 'failed', 'flaky', 'duration'],
  properties: {
    runId: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    totalTests: { type: 'integer' },
    passed: { type: 'integer' },
    failed: { type: 'integer' },
    flaky: { type: 'integer' },
    duration: { type: 'number' },
    title: { type: 'string' },
    displayNumber: { type: 'integer' },
    newRegressions: { type: 'integer' },
    resolvedRegressions: { type: 'integer' },
  },
};

const analyticsDataSchema = {
  type: 'object',
  required: ['overviewStats', 'runHealthMetrics', 'trendMetrics', 'testsSummary', 'regressions'],
  properties: {
    overviewStats: overviewStatsSchema,
    runHealthMetrics: { type: 'array', items: runHealthMetricSchema },
    trendMetrics: {
      type: 'object',
      required: ['durationTrend', 'flakyCountTrend', 'slowCountTrend'],
      properties: {
        durationTrend: {
          type: 'array',
          items: {
            type: 'object',
            required: ['date', 'duration'],
            properties: { date: { type: 'string' }, duration: { type: 'number' } },
          },
        },
        flakyCountTrend: {
          type: 'array',
          items: {
            type: 'object',
            required: ['date', 'count'],
            properties: { date: { type: 'string' }, count: { type: 'integer' } },
          },
        },
        slowCountTrend: {
          type: 'array',
          items: {
            type: 'object',
            required: ['date', 'count'],
            properties: { date: { type: 'string' }, count: { type: 'integer' } },
          },
        },
      },
    },
    testsSummary: {
      type: 'object',
      required: ['total', 'flakyCount'],
      properties: { total: { type: 'integer' }, flakyCount: { type: 'integer' } },
    },
    regressions: {
      type: 'object',
      required: [
        'active',
        'newInWindow',
        'resolvedInWindow',
        'medianMttrDays',
        'topFiles',
        'topCommits',
      ],
      properties: {
        active: { type: 'integer' },
        newInWindow: { type: 'integer' },
        resolvedInWindow: { type: 'integer' },
        medianMttrDays: { type: 'number', nullable: true },
        topFiles: {
          type: 'array',
          items: {
            type: 'object',
            required: ['filePath', 'count'],
            properties: { filePath: { type: 'string' }, count: { type: 'integer' } },
          },
        },
        topCommits: {
          type: 'array',
          items: {
            type: 'object',
            required: ['commit', 'count'],
            properties: { commit: { type: 'string' }, count: { type: 'integer' } },
          },
        },
      },
    },
  },
};

const failureCategoriesDataSchema = {
  type: 'object',
  required: ['categories', 'totalFailures', 'topErrors'],
  properties: {
    categories: {
      type: 'array',
      items: {
        type: 'object',
        required: ['category', 'count', 'percentage'],
        properties: {
          category: { type: 'string' },
          count: { type: 'integer' },
          percentage: { type: 'number' },
        },
      },
    },
    totalFailures: { type: 'integer' },
    topErrors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['message', 'category', 'count', 'signature', 'regressedTestCount'],
        properties: {
          message: { type: 'string' },
          category: { type: 'string' },
          count: { type: 'integer' },
          signature: { type: 'string' },
          sampleReportId: { type: 'string' },
          sampleReportUrl: { type: 'string' },
          sampleTestId: { type: 'string' },
          regressedTestCount: { type: 'integer' },
          affectedTests: {
            type: 'array',
            items: {
              type: 'object',
              required: ['testId', 'title', 'project', 'reportId'],
              properties: {
                testId: { type: 'string' },
                title: { type: 'string' },
                filePath: { type: 'string' },
                project: { type: 'string' },
                reportId: { type: 'string' },
                reportUrl: { type: 'string' },
                isRegressed: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
};

const projectSummaryDataSchema = {
  type: 'object',
  nullable: true,
  required: [
    'project',
    'summary',
    'structured',
    'model',
    'lastReportId',
    'reportCount',
    'firstReportAt',
    'lastReportAt',
    'createdAt',
    'updatedAt',
    'isStale',
    'isTooStale',
  ],
  properties: {
    project: { type: 'string' },
    summary: { type: 'string' },
    structured: { type: 'object', nullable: true, additionalProperties: true },
    model: { type: 'string', nullable: true },
    lastReportId: { type: 'string', nullable: true },
    reportCount: { type: 'integer', nullable: true },
    firstReportAt: { type: 'string', nullable: true },
    lastReportAt: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    isStale: { type: 'boolean' },
    isTooStale: { type: 'boolean' },
    currentLatestReportAt: { type: 'string' },
  },
};

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/analytics',
    {
      preHandler: authorize(CAPABILITIES.view),
      schema: {
        tags: ['Analytics'],
        summary: 'Get overview, trends, and regression analytics',
        security: [{ sessionCookie: [] }, { bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            project: { type: 'string', default: 'all' },
            from: { type: 'string' },
            to: { type: 'string' },
            failedOnly: { type: 'string' },
            environment: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: analyticsDataSchema,
            },
          },
          401: analyticsAuthErrorSchema,
          403: analyticsAuthErrorSchema,
          500: analyticsErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const {
        project = 'all',
        from,
        to,
        failedOnly,
        environment,
      } = request.query as {
        project?: string;
        from?: string;
        to?: string;
        failedOnly?: string;
        environment?: string;
      };
      const failedOnlyFlag = failedOnly === 'true' || failedOnly === '1';
      const { result: analyticsData, error } = await withError(
        analyticsService.getAnalyticsData(project, from, to, failedOnlyFlag, environment)
      );

      if (error) {
        return reply.status(500).send({
          success: false,
          error: `Failed to fetch analytics data: ${error.message}`,
        });
      }

      return { success: true, data: analyticsData };
    }
  );

  fastify.get(
    '/api/analytics/failure-categories',
    {
      preHandler: authorize(CAPABILITIES.view),
      schema: {
        tags: ['Analytics'],
        summary: 'Get aggregated failure categories and top errors',
        security: [{ sessionCookie: [] }, { bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            project: { type: 'string', default: 'all' },
            from: { type: 'string' },
            to: { type: 'string' },
            environment: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: failureCategoriesDataSchema,
            },
          },
          401: analyticsAuthErrorSchema,
          403: analyticsAuthErrorSchema,
          500: analyticsErrorSchema,
        },
      },
    },
    async (request) => {
      const {
        project = 'all',
        from,
        to,
        environment,
      } = request.query as {
        project?: string;
        from?: string;
        to?: string;
        environment?: string;
      };
      const projectKey = project && project !== 'all' ? project : undefined;
      const cats = await failureSummaryDb.getAggregatedCategories(projectKey, 10, {
        from,
        to,
        environment,
      });
      // UI renders 5 top errors and 5 examples each — trim server-side.
      const data = {
        ...cats,
        topErrors: cats.topErrors.slice(0, 5).map((e: (typeof cats.topErrors)[0]) => ({
          ...e,
          affectedTests: e.affectedTests?.slice(0, 5),
        })),
      };
      return { success: true as const, data };
    }
  );

  fastify.get(
    '/api/analytics/run-health',
    {
      attachValidation: true,
      preHandler: authorize(CAPABILITIES.view),
      schema: {
        tags: ['Analytics'],
        summary: 'Get a page of report run health metrics',
        security: [{ sessionCookie: [] }, { bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            project: { type: 'string', default: 'all' },
            from: { type: 'string' },
            to: { type: 'string' },
            failedOnly: { type: 'string' },
            before: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            environment: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['metrics', 'hasMore'],
                properties: {
                  metrics: { type: 'array', items: runHealthMetricSchema },
                  hasMore: { type: 'boolean' },
                },
              },
            },
          },
          401: analyticsAuthErrorSchema,
          403: analyticsAuthErrorSchema,
          500: analyticsErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const {
        project = 'all',
        from,
        to,
        failedOnly,
        before,
        limit,
        environment,
      } = request.query as {
        project?: string;
        from?: string;
        to?: string;
        failedOnly?: string;
        before?: string;
        limit?: string;
        environment?: string;
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
          environment,
        })
      );

      if (error) {
        return reply.status(500).send({
          success: false,
          error: `Failed to fetch run health: ${error.message}`,
        });
      }

      return { success: true, data: { metrics, hasMore: (metrics?.length ?? 0) >= pageLimit } };
    }
  );

  fastify.get(
    '/api/analytics/project-summary',
    {
      preHandler: authorize(CAPABILITIES.view),
      schema: {
        tags: ['Analytics'],
        summary: 'Get the cached LLM project summary and freshness state',
        security: [{ sessionCookie: [] }, { bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: { project: { type: 'string', default: 'all' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'data', 'pendingAnalysisCount', 'pendingEtaFinishAt'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: projectSummaryDataSchema,
              pendingAnalysisCount: { type: 'integer' },
              pendingEtaFinishAt: { type: 'string', nullable: true },
            },
          },
          401: analyticsAuthErrorSchema,
          403: analyticsAuthErrorSchema,
          500: analyticsErrorSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
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
          pendingEtaFinishAt: getProjectEtaFinishAt(projectKey),
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ success: false, error: 'Failed to fetch project summary' });
      }
    }
  );

  fastify.post(
    '/api/analytics/failure-categories/llm',
    {
      attachValidation: true,
      preHandler: authorize(CAPABILITIES.contentLlm),
      schema: {
        tags: ['Analytics'],
        summary: 'Generate or enqueue a project failure analysis',
        description:
          'Optional JSON body: { "reportIds": string[] }. Uses the latest project reports when omitted or when no string IDs are present. Non-string entries are ignored. When selected reports are all green and green-window analysis is disabled, returns a cached all-green summary without creating a task.',
        security: [{ sessionCookie: [] }, { bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: { project: { type: 'string' } },
        },
        response: {
          200: {
            oneOf: [
              {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                  success: { type: 'boolean', enum: [true] },
                  data: {
                    type: 'object',
                    required: ['allGreen'],
                    properties: { allGreen: { type: 'boolean', enum: [true] } },
                  },
                },
              },
              {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                  success: { type: 'boolean', enum: [true] },
                  data: {
                    type: 'object',
                    required: ['taskId', 'deduped'],
                    properties: {
                      taskId: { type: 'string' },
                      deduped: { type: 'boolean' },
                    },
                  },
                },
              },
            ],
          },
          400: analyticsErrorSchema,
          401: analyticsAuthErrorSchema,
          403: analyticsAuthErrorSchema,
          500: analyticsErrorSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
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
