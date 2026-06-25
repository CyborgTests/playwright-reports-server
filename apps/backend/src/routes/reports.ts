import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance } from 'fastify';
import { serveReportRoute } from '../lib/constants.js';
import {
  CompareReportsQuerySchema,
  DeleteReportsRequestSchema,
  EditReportsRequestSchema,
  GenerateReportRequestSchema,
  GetReportParamsSchema,
  ListReportsQuerySchema,
  UploadReportRequestSchema,
} from '../lib/schemas/index.js';
import {
  failureSummaryDb,
  llmTasksDb,
  regressionsDb,
  reportDb,
  testAnalysisDb,
  testDb,
} from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { compareReports } from '../lib/service/reportCompare.js';
import {
  detectFailureCategory,
  testManagementService,
} from '../lib/service/test-management/index.js';
import { storage } from '../lib/storage/index.js';
import { parseFromRequest } from '../lib/storage/pagination.js';
import { ValidationError, validateSchema } from '../lib/validation/index.js';
import { withError } from '../lib/withError.js';
import { authorize } from './auth.js';

const COMPARE_KEYWORDS = new Set(['latest', 'prev', 'previous']);

/**
 * Resolve `latest` / `prev` / `previous` keywords for `report compare`. The
 * keywords are recognized case-insensitively. Non-keyword strings pass through
 * unchanged (they're treated as UUID reportIds by `compareReports`).
 */
function resolveCompareKeywords(
  ids: [string, string],
  project: string | undefined
): { resolved: [string, string]; error?: string } {
  const needs = ids.some((v) => COMPARE_KEYWORDS.has(v.toLowerCase()));
  if (!needs) return { resolved: ids };

  const latest = reportDb.getLatestByProject(project, 2);
  if (latest.length === 0) {
    return {
      resolved: ids,
      error: `Cannot resolve 'latest'/'prev' - no reports found${project ? ` for project '${project}'` : ''}.`,
    };
  }
  const resolve = (raw: string): string | { error: string } => {
    const key = raw.toLowerCase();
    if (key === 'latest') return latest[0].reportID;
    if (key === 'prev' || key === 'previous') {
      if (latest.length < 2) {
        return {
          error: `Cannot resolve 'prev' - only one report found${project ? ` for project '${project}'` : ''}.`,
        };
      }
      return latest[1].reportID;
    }
    return raw;
  };
  const a = resolve(ids[0]);
  if (typeof a !== 'string') return { resolved: ids, error: a.error };
  const b = resolve(ids[1]);
  if (typeof b !== 'string') return { resolved: ids, error: b.error };
  return { resolved: [a, b] };
}

export async function registerReportRoutes(fastify: FastifyInstance) {
  await fastify.register(async (fastify) => {
    fastify.addHook('preHandler', authorize(CAPABILITIES.view));

    fastify.get('/api/report/list', async (request, reply) => {
      try {
        const query = validateSchema(ListReportsQuerySchema, request.query);
        const params = new URLSearchParams();
        if (query.limit !== undefined) {
          params.append('limit', query.limit.toString());
        }
        if (query.offset !== undefined) {
          params.append('offset', query.offset.toString());
        }
        const pagination = parseFromRequest(params);
        const tags = query.tags ? query.tags.split(',').filter(Boolean) : undefined;
        const passRate = query.passRate && query.passRate !== 'all' ? query.passRate : undefined;

        const { result: reports, error } = await withError(
          service.getReports({
            pagination,
            project: query.project,
            search: query.search,
            tags,
            from: query.from,
            to: query.to,
            passRate,
            regressionsOnly: query.regressionsOnly,
          })
        );

        if (error) {
          return reply.status(400).send({ error: error.message });
        }

        if (reports?.reports?.length) {
          const ids = reports.reports.map((r) => r.reportID);
          const countsByReport = regressionsDb.countsForReports(ids);
          for (const r of reports.reports) {
            const counts = countsByReport.get(r.reportID);
            if (counts && (counts.newHere > 0 || counts.resolvedHere > 0)) {
              r.regressions = counts;
            }
          }
        }

        return reports;
      } catch (error) {
        console.error('[routes] list reports error:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    });

    fastify.get('/api/report/compare', async (request, reply) => {
      try {
        const query = validateSchema(CompareReportsQuerySchema, request.query);
        const { resolved, error: resolveError } = resolveCompareKeywords(
          [query.a, query.b],
          query.project
        );
        if (resolveError) {
          return reply.status(400).send({ error: resolveError });
        }
        const [resolvedA, resolvedB] = resolved;
        const { result, error } = compareReports(resolvedA, resolvedB);

        if (error || !result) {
          const message = error ?? 'Failed to compare reports';
          const status = message.includes('not found') || message.includes('itself') ? 400 : 500;
          return reply.status(status).send({ error: message });
        }

        return result;
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.status(400).send({ error: error.message, details: error.details });
        }
        console.error('[routes] compare reports error:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    });

    fastify.get('/api/report/:id', async (request, reply) => {
      try {
        const params = validateSchema(GetReportParamsSchema, request.params);
        const { result: report, error } = await withError(service.getReport(params.id));

        if (error) {
          return reply.status(404).send({ error: error.message });
        }

        if (report) {
          const counts = regressionsDb.countsForReport(report.reportID);
          if (counts.newHere > 0 || counts.resolvedHere > 0) {
            const details = regressionsDb.detailsForReports([report.reportID], 500);
            const entry = details.get(report.reportID);
            report.regressions = {
              ...counts,
              newTests: entry && entry.newHere.length > 0 ? entry.newHere : undefined,
              resolvedTests:
                entry && entry.resolvedHere.length > 0 ? entry.resolvedHere : undefined,
            };
          }
        }

        return report;
      } catch (error) {
        console.error('[routes] get report error:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    });

    fastify.get('/api/report/projects', async (_request, reply) => {
      const { result: projects, error } = await withError(service.getReportsProjects());

      if (error) {
        return reply.status(400).send({ error: error.message });
      }

      return projects;
    });

    fastify.get('/api/report/tags', async (request, reply) => {
      const query = request.query as { project?: string };
      const { result: tags, error } = await withError(service.getReportsTags(query.project));

      if (error) {
        return reply.status(400).send({ error: error.message });
      }

      return tags;
    });

    fastify.post(
      '/api/report/generate',
      { preHandler: authorize(CAPABILITIES.contentReports) },
      async (request, reply) => {
        try {
          const body = (request.body as { resultsIds?: unknown; [key: string]: unknown }) || {};

          if (!body.resultsIds || !Array.isArray(body.resultsIds)) {
            return reply.status(400).send({ error: 'resultsIds array is required' });
          }

          if (body.resultsIds.length === 0) {
            return reply.status(400).send({ error: 'At least one result ID must be provided' });
          }

          const validatedBody = validateSchema(GenerateReportRequestSchema, body);

          const metadata: Record<string, string> = {
            ...(validatedBody.project && { project: validatedBody.project }),
            ...(validatedBody.playwrightVersion && {
              playwrightVersion: validatedBody.playwrightVersion,
            }),
            ...(validatedBody.title && { title: validatedBody.title }),
            ...Object.fromEntries(
              Object.entries(validatedBody)
                .filter(
                  ([key]) =>
                    !['resultsIds', 'project', 'playwrightVersion', 'title'].includes(key) &&
                    typeof validatedBody[key as keyof typeof validatedBody] === 'string'
                )
                .map(([key, value]) => [key, String(value)])
            ),
          };

          const { result, error } = await withError(
            service.generateReport(validatedBody.resultsIds, metadata)
          );

          if (error) {
            console.error(`[routes] generate report error:`, error.message);

            if (
              error instanceof Error &&
              error.message.includes('ENOENT: no such file or directory')
            ) {
              return reply.status(404).send({
                error: `ResultID not found: ${error.message}`,
              });
            }

            return reply.status(400).send({ error: error.message });
          }

          console.log(`[routes] generate report success: ${result?.reportId}`);
          return result;
        } catch (error) {
          console.error('[routes] generate report validation error:', error);
          return reply.status(400).send({ error: 'Invalid request format' });
        }
      }
    );

    fastify.patch(
      '/api/report/edit',
      { preHandler: authorize(CAPABILITIES.contentReports) },
      async (request, reply) => {
        try {
          const validatedBody = validateSchema(EditReportsRequestSchema, request.body ?? {});

          const { result, error } = await withError(
            service.updateReports(validatedBody.reportsIds, {
              project: validatedBody.project,
              tags: validatedBody.tags,
              removeTags: validatedBody.removeTags,
            })
          );

          if (error) {
            console.error('[routes] edit reports error:', error);
            return reply.status(500).send({ error: error.message });
          }

          if (result && result.missing.length > 0) {
            return reply.status(404).send({
              error: `Reports not found: ${result.missing.join(', ')}`,
              missing: result.missing,
            });
          }

          return reply.status(200).send({
            message: 'Reports updated successfully',
            reportsIds: validatedBody.reportsIds,
            updated: result?.updated ?? 0,
          });
        } catch (error) {
          if (error instanceof ValidationError) {
            return reply.status(400).send({ error: error.message, details: error.details });
          }
          console.error('[routes] edit reports validation error:', error);
          return reply.status(400).send({ error: 'Invalid request format' });
        }
      }
    );

    fastify.delete(
      '/api/report/delete',
      { preHandler: authorize(CAPABILITIES.contentReports) },
      async (request, reply) => {
        try {
          const body = (request.body as { reportsIds?: unknown }) || { reportsIds: [] };

          if (!body.reportsIds || !Array.isArray(body.reportsIds)) {
            return reply.status(400).send({ error: 'reportsIds array is required' });
          }

          if (body.reportsIds.length === 0) {
            return reply.status(400).send({ error: 'At least one report ID must be provided' });
          }

          const validatedBody = validateSchema(DeleteReportsRequestSchema, body);

          const { error } = await withError(service.deleteReports(validatedBody.reportsIds));

          if (error) {
            console.error(`[routes] delete reports error:`, error);
            return reply.status(404).send({ error: error.message });
          }

          return reply.status(200).send({
            message: 'Reports deleted successfully',
            reportsIds: validatedBody.reportsIds,
          });
        } catch (error) {
          console.error('[routes] delete reports validation error:', error);
          return reply.status(400).send({ error: 'Invalid request format' });
        }
      }
    );

    // GET /api/report/:id/failure-summary - get stored failure summary for a report
    fastify.get('/api/report/:id/failure-summary', async (request, reply) => {
      try {
        const { id } = (request as { params: { id: string } }).params;
        const summary = failureSummaryDb.getSummary(id);

        const runs = testDb.getTestRunsByReport(id);
        const hasFailures = runs.some(
          (r) => r.outcome === 'unexpected' || r.outcome === 'failed' || r.outcome === 'flaky'
        );

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
    });

    // POST /api/report/:id/analyze - trigger analysis for a specific report
    fastify.post(
      '/api/report/:id/analyze',
      { preHandler: authorize(CAPABILITIES.contentLlm) },
      async (request, reply) => {
        try {
          const { id } = (request as { params: { id: string } }).params;
          const testRuns = testDb.getTestRunsByReport(id);

          const failedRuns = testRuns.filter(
            (run) =>
              run.failureDetails ||
              run.outcome === 'unexpected' ||
              run.outcome === 'failed' ||
              run.outcome === 'flaky'
          );

          const seen = new Set<string>();
          let queued = 0;
          let skipped = 0;
          let project: string | undefined;

          const findReuseSource = (
            testId: string,
            fileId: string,
            proj: string,
            errorSignature: string | undefined,
            heuristicCategory: string,
            currentReportId: string
          ) => {
            if (!errorSignature) return null;
            return testAnalysisDb.findReuseSource(
              testId,
              fileId,
              proj,
              errorSignature,
              heuristicCategory,
              currentReportId
            );
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
      }
    );
  });

  await fastify.register(async (fastify) => {
    fastify.addHook('preHandler', authorize(CAPABILITIES.contentReports));

    fastify.post('/api/report/upload', async (request, reply) => {
      let metadata: Record<string, unknown> = {};
      let fileFound = false;
      let tempZipPath: string | null = null;
      const parts = request.parts();
      const reportId = randomUUID();

      try {
        for await (const part of parts) {
          if (part.type === 'field' && part.fieldname === 'metadata') {
            try {
              metadata = JSON.parse(part.value as string);
            } catch {
              // fall through with empty metadata
            }
          } else if (part.type === 'file' && !fileFound) {
            fileFound = true;
            const validatedMetadata = validateSchema(UploadReportRequestSchema, metadata) as Record<
              string,
              string | number | undefined
            >;

            tempZipPath = path.join(os.tmpdir(), `report-upload-${reportId}.zip`);
            await pipeline(part.file, createWriteStream(tempZipPath));

            const { error: uploadError, result: uploaded } = await withError(
              storage.uploadReportFromZipFile(reportId, tempZipPath, validatedMetadata)
            );

            if (uploadError) {
              throw uploadError;
            }

            if (!uploaded?.report) {
              throw new Error('Failed to read uploaded report');
            }

            const report = uploaded.report;
            reportDb.onCreated(report);

            const { error: testsError } = await withError(
              testManagementService.processReport(report)
            );

            if (testsError) {
              console.error('[routes] upload report - process tests error:', testsError);
            }

            const reportUrl = `${serveReportRoute}/${reportId}/index.html`;
            return { reportId, reportUrl, metadata: validatedMetadata };
          }
        }

        if (!fileFound) {
          return reply.status(400).send({ error: 'No file uploaded' });
        }
      } catch (error) {
        console.error('[routes] upload report error:', error);
        const message = error instanceof Error ? error.message : 'Upload failed';
        return reply.status(500).send({ error: message });
      } finally {
        if (tempZipPath) {
          await fs.unlink(tempZipPath).catch(() => {
            // ignore: temp file may already be gone if write failed
          });
        }
      }
    });
  });
}
