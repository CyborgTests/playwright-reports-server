import { existsSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path, { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, KEY_SCOPES, keyCan } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mime from 'mime';
import { env } from '../config/env.js';
import { can } from '../lib/auth/access.js';
import { resolveApiKey } from '../lib/auth/apiKeys.js';
import { resolveIdentity } from '../lib/auth/resolve.js';
import { llmService } from '../lib/llm/index.js';
import { injectTestAnalysis } from '../lib/report-injection/html-injector.js';
import { classifyServeMiss, renderNoticePage, storageUnreachable } from '../lib/report-notice.js';
import { reportDb } from '../lib/service/db/index.js';
import { DATA_FOLDER, REPORTS_FOLDER } from '../lib/storage/constants.js';
import { storage } from '../lib/storage/index.js';
import { streamToString } from '../lib/storage/streamUtils.js';
import { type ByteRange, parseRangeHeader } from '../lib/storage/types.js';
import { extractReportIdFromPath } from '../lib/utils/url-parser.js';
import { withError } from '../lib/withError.js';

// locate the backend `public/` dir relative to this module.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_PUBLIC_DIR =
  [resolve(moduleDir, '..', 'public'), resolve(moduleDir, '..', '..', 'public')].find((p) =>
    existsSync(p)
  ) ?? resolve(moduleDir, '..', '..', 'public');

const SHARE_COOKIE = 'pwrs_share';
const SHARE_COOKIE_MAX_AGE_S = 24 * 60 * 60;

// A share link carries a view-only `share`-scoped API key via `?token=`. Use it only
// for share keys and hand it off to a path-scoped cookie
// so the report's relative sub-resources authenticate without the query param.
function resolveShareAccess(request: FastifyRequest, reply: FastifyReply): boolean {
  const queryToken = (request.query as { token?: string })?.token;
  const token = queryToken || request.cookies?.[SHARE_COOKIE];
  if (!token) return false;
  const key = resolveApiKey(token);
  if (!key || !key.scopes.includes(KEY_SCOPES.share)) return false;
  if (queryToken) {
    reply.setCookie(SHARE_COOKIE, queryToken, {
      path: '/api/serve',
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: SHARE_COOKIE_MAX_AGE_S,
    });
  }
  return true;
}

// A denied viewer (typically a revoked/expired share link) should see a page, not raw JSON.
const ACCESS_DENIED_HTML = renderNoticePage({
  emoji: '🕵️',
  title: 'This link is in witness protection',
  message:
    'Report may not exist, share link has expired, been revoked, or just a product of imagination.',
  hint: 'Ask whoever sent it for a fresh link - or <a href="/">sign in</a> if you have an account.',
});

function sendServeDenied(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const acceptsHtml = (request.headers.accept ?? '').includes('text/html');
  if (acceptsHtml) {
    return reply.code(403).type('text/html').send(ACCESS_DENIED_HTML);
  }
  return reply.code(403).send({ success: false, error: 'Forbidden' });
}

export async function registerServeRoutes(fastify: FastifyInstance) {
  fastify.get('/api/serve/*', async (request, reply) => {
    try {
      const filePath = (request.params as { '*': string })['*'] || '';
      let rawPath: string;
      try {
        rawPath = decodeURIComponent(filePath);
      } catch {
        return reply.code(400).send({ success: false, error: 'Invalid path' });
      }

      // Normalize and strip leading separators so the path is interpreted as a
      // descendant of the reports namespace.
      const safeRelative = path.normalize(rawPath).replace(/^([/\\])+/, '');
      if (safeRelative === '..' || safeRelative.startsWith(`..${sep}`)) {
        return reply.code(400).send({ success: false, error: 'Invalid path' });
      }
      const reportsRoot = resolve(REPORTS_FOLDER);
      const resolved = resolve(reportsRoot, safeRelative);
      if (resolved !== reportsRoot && !resolved.startsWith(reportsRoot + sep)) {
        return reply.code(400).send({ success: false, error: 'Invalid path' });
      }
      const targetPath = safeRelative;

      const authRequired = !!env.API_TOKEN;
      const identity = resolveIdentity(request);

      let viaShare = false;
      if (authRequired) {
        viaShare = resolveShareAccess(request, reply);
        const canView =
          !!identity &&
          (identity.via === 'apikey'
            ? keyCan(identity.scopes, identity.capability ?? 'read', CAPABILITIES.view)
            : can(identity.role, CAPABILITIES.view));
        if (!viaShare && !canView) return sendServeDenied(request, reply);
      }

      const contentType = mime.getType(targetPath.split('/').pop() || '');

      if (!contentType && !targetPath.includes('.')) {
        return reply.code(404).send({ success: false, error: 'Not Found' });
      }

      const isIndexHtml = contentType === 'text/html' && targetPath.endsWith('index.html');
      // no Range for index.html: it's mutated (LLM button injection) and served whole.
      const rangeHeader =
        !isIndexHtml && typeof request.headers.range === 'string'
          ? request.headers.range.trim()
          : undefined;
      const range: ByteRange | undefined = rangeHeader ? parseRangeHeader(rangeHeader) : undefined;

      // one indexed point-lookup per served file;
      // add a reportId->prefix memo cache only if serve throughput needs.
      let effectivePath = targetPath;
      const reportSegment = targetPath.split('/')[0];
      const storagePath = reportSegment ? reportDb.getStoragePath(reportSegment) : null;
      if (storagePath && storagePath !== reportSegment) {
        const rewritten = storagePath + targetPath.slice(reportSegment.length);
        const resolvedRewritten = resolve(reportsRoot, rewritten);
        if (resolvedRewritten === reportsRoot || resolvedRewritten.startsWith(reportsRoot + sep)) {
          effectivePath = rewritten;
        }
      }

      const { result, error } = await withError(
        storage.readFile(effectivePath, contentType || null, range)
      );

      if (error || !result) {
        const miss = error
          ? storageUnreachable(error.message)
          : classifyServeMiss(
              targetPath,
              reportSegment ? reportDb.getArtifactState(reportSegment) : undefined,
              'File not found',
              viaShare
            );
        reply.header('Cache-Control', 'no-store');
        if ((request.headers.accept ?? '').includes('text/html')) {
          return reply.code(miss.status).type('text/html').send(renderNoticePage(miss.notice));
        }
        return reply.code(miss.status).send({ success: false, error: miss.error });
      }

      const headers: Record<string, string> = {
        'Content-Type': contentType ?? 'application/octet-stream',
      };
      if (isIndexHtml) {
        headers['Cache-Control'] = 'private, max-age=60, must-revalidate';
      } else {
        headers['Cache-Control'] = 'public, max-age=86400, must-revalidate';
      }

      if (!isIndexHtml) {
        headers['Accept-Ranges'] = 'bytes';
        if (result.size !== undefined) headers['Content-Length'] = String(result.size);

        if (result.contentRange) {
          const { start, end, total } = result.contentRange;

          // Unsatisfiable range (start past EOF) — 416 Range Not Satisfiable.
          if (result.size !== undefined && result.size <= 0) {
            return reply
              .code(416)
              .headers({ ...headers, 'Content-Range': `bytes */${total}` })
              .send();
          }

          headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
          return reply.code(206).headers(headers).send(result.body);
        }

        return reply.code(200).headers(headers).send(result.body);
      }

      let reportHtml: string;
      try {
        reportHtml = await streamToString(result.body);
      } catch (err) {
        fastify.log.error({ err, targetPath }, '[serve] failed to buffer index.html');
        return reply.code(500).send({ error: 'failed to read report index' });
      }

      const isLlmEnabled = llmService.isConfigured() && !viaShare;
      // Whether the viewer may edit the root-cause category (admin/member, not readonly).
      // The PATCH endpoint enforces this server-side too; this only hides the affordance.
      const canEditCategory = identity
        ? identity.via === 'apikey'
          ? keyCan(identity.scopes, identity.capability ?? 'read', CAPABILITIES.contentTests)
          : can(identity.role, CAPABILITIES.contentTests)
        : false;
      // `content:share` (default admin+member, matrix-configurable) governs using share
      // tokens to produce a link; minting a new token is still admin-only key creation.
      const canShare = authRequired && !viaShare && can(identity?.role, CAPABILITIES.shareReports);
      const canCreateShare =
        authRequired && !viaShare && can(identity?.role, CAPABILITIES.apiKeysService);
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
          injectTestAnalysis(
            reportHtml,
            testUrl,
            isLlmEnabled,
            canEditCategory,
            canShare,
            canCreateShare
          )
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
      return reply.code(400).send({ success: false, error: 'Invalid path' });
    }

    const contentType = mime.getType(targetPath.split('/').pop() || '');

    if (!contentType && !targetPath.includes('.')) {
      return reply.code(404).send({ success: false, error: 'Not Found' });
    }

    const brandingRoot = resolve(DATA_FOLDER, 'branding');
    const publicRoot = BACKEND_PUBLIC_DIR;
    const safeRelative = path.normalize(targetPath).replace(/^([/\\])+/, '');
    const candidateInBranding = resolve(DATA_FOLDER, safeRelative);
    const candidateInPublic = resolve(publicRoot, safeRelative);

    const isInside = (child: string, parent: string) =>
      child === parent || child.startsWith(parent + sep);

    const inBranding = isInside(candidateInBranding, brandingRoot);
    const inPublic = isInside(candidateInPublic, publicRoot);
    if (!inBranding && !inPublic) {
      return reply.code(400).send({ success: false, error: 'Invalid path' });
    }

    let imagePath: string | null = null;
    if (inBranding) {
      const { error: brandingAccessError } = await withError(access(candidateInBranding));
      if (!brandingAccessError) imagePath = candidateInBranding;
    }
    if (!imagePath && inPublic) imagePath = candidateInPublic;

    if (!imagePath) {
      return reply.code(404).send({ error: 'File not found' });
    }

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
