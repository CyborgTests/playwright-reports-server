import { existsSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path, { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import mime from 'mime';
import { env } from '../config/env.js';
import { llmService } from '../lib/llm/index.js';
import { reportDb } from '../lib/service/db/reports.sqlite.js';
import { DATA_FOLDER, REPORTS_FOLDER } from '../lib/storage/constants.js';
import { storage } from '../lib/storage/index.js';
import { streamToString } from '../lib/storage/streamUtils.js';
import { injectTestAnalysis } from '../lib/utils/html-injector.js';
import { extractReportIdFromPath } from '../lib/utils/url-parser.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

// locate the backend `public/` dir relative to this module.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_PUBLIC_DIR =
  [resolve(moduleDir, '..', 'public'), resolve(moduleDir, '..', '..', 'public')].find((p) =>
    existsSync(p)
  ) ?? resolve(moduleDir, '..', '..', 'public');

export async function registerServeRoutes(fastify: FastifyInstance) {
  fastify.get('/api/serve/*', async (request, reply) => {
    try {
      const filePath = (request.params as { '*': string })['*'] || '';
      let rawPath: string;
      try {
        rawPath = decodeURIComponent(filePath);
      } catch {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      // Normalize and strip leading separators so the path is interpreted as a
      // descendant of the reports namespace.
      const safeRelative = path.normalize(rawPath).replace(/^([/\\])+/, '');
      if (safeRelative === '..' || safeRelative.startsWith(`..${sep}`)) {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      const reportsRoot = resolve(REPORTS_FOLDER);
      const resolved = resolve(reportsRoot, safeRelative);
      if (resolved !== reportsRoot && !resolved.startsWith(reportsRoot + sep)) {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      const targetPath = safeRelative;

      const authRequired = !!env.API_TOKEN;

      if (authRequired) {
        await authenticate(request as AuthRequest, reply);
        if (reply.sent) return;
      }

      const contentType = mime.getType(targetPath.split('/').pop() || '');

      if (!contentType && !targetPath.includes('.')) {
        return reply.code(404).send({ error: 'Not Found' });
      }

      const { result, error } = await withError(storage.readFile(targetPath, contentType || null));

      if (error || !result) {
        return reply.code(404).send({
          error: `Could not read file: ${error?.message || 'File not found'}`,
        });
      }

      const headers: Record<string, string> = {
        'Content-Type': contentType ?? 'application/octet-stream',
      };
      const isIndexHtml = contentType === 'text/html' && targetPath.endsWith('index.html');

      if (isIndexHtml) {
        headers['Cache-Control'] = 'private, max-age=60, must-revalidate';
      } else {
        headers['Cache-Control'] = 'public, max-age=86400, must-revalidate';
      }

      if (!isIndexHtml) {
        if (result.size !== undefined) headers['Content-Length'] = String(result.size);
        return reply.code(200).headers(headers).send(result.body);
      }

      let reportHtml: string;
      try {
        reportHtml = await streamToString(result.body);
      } catch (err) {
        fastify.log.error({ err, targetPath }, '[serve] failed to buffer index.html');
        return reply.code(500).send({ error: 'failed to read report index' });
      }

      const isLlmEnabled = llmService.isConfigured();
      const reportId = extractReportIdFromPath(targetPath);
      if (reportId && reportId !== 'trace') {
        const report = reportDb.getByID(reportId);
        const testUrl = {
          reportId,
          project: report?.project ?? '',
          testId: 'unknown',
          isPlaywrightReport: true,
          isTestPage: false,
        };
        const { result: injected, error: injectionError } = await withError(
          injectTestAnalysis(reportHtml, testUrl, isLlmEnabled)
        );
        if (injectionError) {
          console.error('[serve] Failed to inject LLM analysis:', injectionError);
        } else if (injected) {
          reportHtml = injected;
        }
      } else {
        console.warn('[serve] missing reportId, skipping button injection');
      }

      return reply.code(200).headers(headers).send(reportHtml);
    } catch (error) {
      fastify.log.error({ error }, 'File serving error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/api/static/*', async (request, reply) => {
    const filePath = (request.params as { '*': string })['*'] || '';
    let targetPath: string;
    try {
      targetPath = decodeURIComponent(filePath);
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const contentType = mime.getType(targetPath.split('/').pop() || '');

    if (!contentType && !targetPath.includes('.')) {
      return reply.code(404).send({ error: 'Not Found' });
    }

    const dataRoot = resolve(DATA_FOLDER);
    const publicRoot = BACKEND_PUBLIC_DIR;
    const safeRelative = path.normalize(targetPath).replace(/^([/\\])+/, '');
    const candidateInData = resolve(dataRoot, safeRelative);
    const candidateInPublic = resolve(publicRoot, safeRelative);

    const isInside = (child: string, parent: string) =>
      child === parent || child.startsWith(parent + sep);

    if (!isInside(candidateInData, dataRoot) && !isInside(candidateInPublic, publicRoot)) {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const { error: dataAccessError } = await withError(access(candidateInData));
    const imagePath = dataAccessError ? candidateInPublic : candidateInData;

    const { result: imageBuffer, error: readError } = await withError(readFile(imagePath));

    if (readError) {
      return reply.code(404).send({ error: 'File not found' });
    }

    return reply
      .code(200)
      .header('Content-Type', contentType || 'image/*')
      .header('Cache-Control', 'public, max-age=300, must-revalidate')
      .send(imageBuffer);
  });
}
