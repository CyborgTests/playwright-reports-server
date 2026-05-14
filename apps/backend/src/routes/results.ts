import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Result } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DeleteResultsRequestSchema, ListResultsQuerySchema } from '../lib/schemas/index.js';
import { reportResultsDb } from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { DEFAULT_STREAM_CHUNK_SIZE } from '../lib/storage/constants.js';
import { parseFromRequest } from '../lib/storage/pagination.js';
import { validateSchema } from '../lib/validation/index.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate, authenticateUpload } from './auth.js';

export async function registerResultRoutes(fastify: FastifyInstance) {
  await fastify.register(async (fastify) => {
    fastify.addHook('preHandler', (request, reply) => authenticate(request as AuthRequest, reply));

    fastify.get('/api/result/list', async (request, reply) => {
      try {
        const query = validateSchema(ListResultsQuerySchema, request.query);
        const params = new URLSearchParams();
        if (query.limit !== undefined) {
          params.append('limit', query.limit.toString());
        }
        if (query.offset !== undefined) {
          params.append('offset', query.offset.toString());
        }
        const pagination = parseFromRequest(params);
        const tags = query.tags ? query.tags.split(',').filter(Boolean) : [];
        const usage = query.usage && query.usage !== 'all' ? query.usage : undefined;

        const { result, error } = await withError(
          service.getResults({
            pagination,
            project: query.project,
            tags,
            search: query.search,
            from: query.from,
            to: query.to,
            usage,
          })
        );

        if (error) {
          return reply.status(400).send({ error: error.message });
        }

        if (result?.results?.length) {
          const ids = result.results.map((r) => r.resultID);
          const reportsByResult = reportResultsDb.getReportsForResultIds(ids);
          for (const row of result.results) {
            const linked = reportsByResult.get(row.resultID) ?? [];
            (row as Record<string, unknown>).linkedReports = linked.map((r) => ({
              reportID: r.reportID,
              displayNumber: r.displayNumber,
            }));
          }
        }

        return result;
      } catch (error) {
        console.error('[routes] list results error:', error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    });

    fastify.get('/api/result/projects', async (_request, reply) => {
      const { result: projects, error } = await withError(service.getResultsProjects());

      if (error) {
        return reply.status(400).send({ error: error.message });
      }

      return projects;
    });

    fastify.get('/api/result/tags', async (_request, reply) => {
      const { result: tags, error } = await withError(service.getResultsTags());

      if (error) {
        return reply.status(400).send({ error: error.message });
      }

      return tags;
    });

    fastify.delete(
      '/api/result/delete',
      {
        config: {
          rawBody: true,
        },
      },
      async (request, reply) => {
        try {
          const body = (request.body as { resultsIds?: unknown }) || { resultsIds: [] };

          if (!body.resultsIds || !Array.isArray(body.resultsIds)) {
            return reply.status(400).send({ error: 'resultsIds array is required' });
          }

          if (body.resultsIds.length === 0) {
            return reply.status(400).send({ error: 'At least one result ID must be provided' });
          }

          const validatedBody = validateSchema(DeleteResultsRequestSchema, body);

          const { error } = await withError(service.deleteResults(validatedBody.resultsIds));

          if (error) {
            console.error(`[routes] delete results error:`, error);
            return reply.status(404).send({ error: error.message });
          }

          return reply.status(200).send({
            message: 'Results files deleted successfully',
            resultsIds: validatedBody.resultsIds,
          });
        } catch (error) {
          console.error('[routes] delete results validation error:', error);
          return reply.status(400).send({ error: 'Invalid request format' });
        }
      }
    );
  });

  await fastify.register(async (fastify) => {
    fastify.addHook('preHandler', (request, reply) =>
      authenticateUpload(request as AuthRequest, reply)
    );

    fastify.put('/api/result/upload', async (request, reply) => {
      const resultID = randomUUID();
      const fileName = `${resultID}.zip`;

      const query = request.query as Record<string, string>;
      const contentLength = query['fileContentLength'] || '';

      // When fileContentLength is provided we can hand back a presigned URL for direct upload.
      const presignedUrl = contentLength ? await service.getPresignedUrl(fileName) : '';

      const filePassThrough = new PassThrough({
        highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
      });

      const { result, error: uploadError } = await withError(
        processMultipartAndUpload(request, fileName, filePassThrough, {
          presignedUrl,
          contentLength,
        })
      );

      if (uploadError) {
        await withError(service.deleteResults([resultID]));
        return reply.status(400).send({
          error: uploadError.message,
        });
      }

      if (!result) {
        await withError(service.deleteResults([resultID]));
        return reply.status(400).send({ error: 'upload result failed: No result data' });
      }

      const { result: uploadResult, error: uploadResultDetailsError } = await withError(
        service.saveResultDetails(resultID, result.details, result.fileSize)
      );

      if (uploadResultDetailsError) {
        await withError(service.deleteResults([resultID]));
        return reply.status(400).send({
          error: `upload result details failed: ${uploadResultDetailsError.message}`,
        });
      }

      const { result: generatedReport, error: reportError } = await withError(
        maybeGenerateReport(resultID, result.details)
      );

      if (reportError) {
        return reply.status(400).send({
          error: `failed to generate report: ${reportError.message}`,
        });
      }

      if (generatedReport && typeof generatedReport === 'object' && 'reportId' in generatedReport) {
        console.log(
          `[upload] generated report ${(generatedReport as { reportId: string }).reportId}`
        );
      }

      return reply.status(200).send({
        message: 'Success',
        data: {
          ...uploadResult,
          generatedReport,
        },
      });
    });
  });
}

async function processMultipartAndUpload(
  request: FastifyRequest,
  fileName: string,
  passThrough: PassThrough,
  opts: { presignedUrl?: string; contentLength?: string }
): Promise<{ details: Record<string, string>; fileSize: number }> {
  const details: Record<string, string> = {};
  const parts = request.parts();
  let fileFound = false;
  let fileSize = 0;

  const savePromise = service.saveResult(fileName, passThrough, {
    presignedUrl: opts.presignedUrl,
    contentLength: opts.contentLength,
    shouldStoreLocalCopy: true,
  });

  try {
    for await (const part of parts) {
      if (part.type === 'field') {
        details[part.fieldname] = part.value as string;
        continue;
      }

      if (part.type === 'file' && !fileFound) {
        fileFound = true;

        const fileStream = part.file;
        fileStream.on('data', (chunk: Buffer) => {
          fileSize += chunk.length;
        });

        await pipeline(fileStream, passThrough);
      }
    }

    if (!fileFound) {
      if (!passThrough.destroyed) passThrough.destroy();
      throw new Error('upload result failed: No file received');
    }

    await savePromise;

    return { details, fileSize };
  } catch (err) {
    if (!passThrough.destroyed) passThrough.destroy();
    throw err;
  }
}

async function maybeGenerateReport(
  resultId: string,
  resultDetails: Record<string, string>
): Promise<unknown> {
  const enabledReportGeneration = resultDetails.triggerReportGeneration === 'true';
  const shouldGenerateForShardedRun =
    enabledReportGeneration && resultDetails.shardTotal && resultDetails.shardTotal !== '1';
  const shouldGenerateForSingleRun = enabledReportGeneration && !resultDetails.shardTotal;

  if (!shouldGenerateForShardedRun && !shouldGenerateForSingleRun) {
    console.log(`[upload] skipping report generation`);
    return null;
  }

  const resultQuery = shouldGenerateForSingleRun
    ? {
        search: resultId,
      }
    : { testRun: resultDetails.testRun, project: resultDetails.project };

  const { result: results, error: resultsError } = await withError(service.getResults(resultQuery));

  if (resultsError) {
    throw new Error(`failed to generate report: ${resultsError.message}`);
  }

  const testRunResults = results?.results;

  console.log(
    `[upload] found ${testRunResults?.length} results for test run ${resultDetails.testRun}`
  );

  const expected = shouldGenerateForSingleRun ? 1 : Number.parseInt(resultDetails.shardTotal, 10);
  if (testRunResults?.length !== expected) {
    return null;
  }

  const ids = testRunResults.map((result: Result) => result.resultID);

  console.log(`[upload] triggering report generation for ${resultDetails.testRun}`);

  const { result, error } = await withError(
    service.generateReport(ids, {
      project: resultDetails.project,
      testRun: resultDetails.testRun,
      playwrightVersion: resultDetails.playwrightVersion,
    })
  );

  if (error) {
    throw new Error(`failed to generate report: ${error.message}`);
  }

  return result;
}
