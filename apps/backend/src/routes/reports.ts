import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { serveReportRoute } from '../lib/constants.js';
import {
  DeleteReportsRequestSchema,
  GenerateReportRequestSchema,
  GetReportParamsSchema,
  ListReportsQuerySchema,
  UploadReportRequestSchema,
} from '../lib/schemas/index.js';
import { reportDb } from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { testManagementService } from '../lib/service/testManagement.js';
import { storage } from '../lib/storage/index.js';
import { parseFromRequest } from '../lib/storage/pagination.js';
import { validateSchema } from '../lib/validation/index.js';
import { withError } from '../lib/withError.js';

export async function registerReportRoutes(fastify: FastifyInstance) {
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

      const { result: reports, error } = await withError(
        service.getReports({
          pagination,
          project: query.project,
          search: query.search,
        })
      );

      if (error) {
        return reply.status(400).send({ error: error.message });
      }

      return reports;
    } catch (error) {
      console.error('[routes] list reports error:', error);
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

      return report;
    } catch (error) {
      console.error('[routes] get report error:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/api/report/projects', async (_request, reply) => {
    try {
      const { result: projects, error } = await withError(service.getReportsProjects());

      if (error) {
        return reply.status(400).send({ error: error.message });
      }

      return projects;
    } catch (error) {
      console.error('[routes] get projects error:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/api/report/generate', async (request, reply) => {
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

        if (error instanceof Error && error.message.includes('ENOENT: no such file or directory')) {
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
  });

  fastify.delete('/api/report/delete', async (request, reply) => {
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
  });

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
}
