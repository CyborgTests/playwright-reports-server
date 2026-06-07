import { existsSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path, { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import mime from 'mime';
import { env } from '../config/env.js';
import { llmService } from '../lib/llm/index.js';
import { DATA_FOLDER, REPORTS_FOLDER } from '../lib/storage/constants.js';
import { storage } from '../lib/storage/index.js';
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
      const rawPath = decodeURI(filePath);

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
        const authResult = await authenticate(request as AuthRequest, reply);
        if (authResult) return;
      }

      const contentType = mime.getType(targetPath.split('/').pop() || '');

      if (!contentType && !targetPath.includes('.')) {
        return reply.code(404).send({ error: 'Not Found' });
      }

      const { result: content, error } = await withError(
        storage.readFile(targetPath, contentType || null)
      );

      if (error || !content) {
        return reply.code(404).send({
          error: `Could not read file: ${error?.message || 'File not found'}`,
        });
      }

      let reportHtml = content;
      const headers: Record<string, string> = {
        'Content-Type': contentType ?? 'application/octet-stream',
      };

      const isLlmEnabled = llmService.isConfigured();
      const isIndexHtml = contentType === 'text/html' && targetPath.endsWith('index.html');

      if (isIndexHtml) {
        const reportId = extractReportIdFromPath(targetPath);

        try {
          if (!reportId) {
            console.warn('[serve] missing reportId, skipping button injection');
            throw new Error('missing reportId or testId, skipping button injection');
          }

          const testUrl = {
            reportId,
            // testId is resolved client-side once the user clicks into a test page.
            testId: 'unknown',
            isPlaywrightReport: true,
            isTestPage: false,
          };

          reportHtml = await injectTestAnalysis(content.toString(), testUrl, isLlmEnabled);
        } catch (injectionError) {
          // Fall through with the original content if injection fails.
          console.error('[serve] Failed to inject LLM analysis:', injectionError);
        }
      }

      if ((request as AuthRequest).user?.apiToken) {
        headers['X-API-Token'] = (request as AuthRequest).user?.apiToken ?? '';
      }

      // Report served assets are effectively immutable per reportId.
      // Cache on the static assets keeps browsers from refetching CSS/JS/img
      // on every navigation; a shorter window on the injected index.html so
      // LLM config flips reach the user within a minute even without a reload.
      if (isIndexHtml) {
        headers['Cache-Control'] = 'private, max-age=60, must-revalidate';
      } else {
        headers['Cache-Control'] = 'public, max-age=86400, must-revalidate';
      }

      return reply.code(200).headers(headers).send(reportHtml);
    } catch (error) {
      fastify.log.error({ error }, 'File serving error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/api/static/*', async (request, reply) => {
    try {
      const filePath = (request.params as { '*': string })['*'] || '';
      const targetPath = decodeURI(filePath);

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

      const imageBuffer = await readFile(imagePath);

      return reply
        .code(200)
        .header('Content-Type', contentType || 'image/*')
        .header('Cache-Control', 'public, max-age=300, must-revalidate')
        .send(imageBuffer);
    } catch (error) {
      fastify.log.error({ error }, 'Static file serving error');
      return reply.code(404).send({ error: 'File not found' });
    }
  });
}
