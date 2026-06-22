import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  type LlmScreenshotSource,
  type LlmTaskRouting,
  type LlmTaskType,
  SCREENSHOTS_MAX_CAP,
} from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { defaultConfig } from '../lib/config.js';
import { validateRouting } from '../lib/llm/routing/index.js';
import { normalizeReporterPaths, validateReporterPaths } from '../lib/pw-reporters.js';
import { CronService, cronService } from '../lib/service/cron.js';
import { getDatabaseStats, llmModelsDb } from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { testManagementService } from '../lib/service/test-management/index.js';
import { DATA_FOLDER } from '../lib/storage/constants.js';
import { storage } from '../lib/storage/index.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate, isAuthenticated } from './auth.js';

interface MultipartFile {
  fieldname: string;
  filename?: string;
  file: Readable & { truncated?: boolean };
}

const BRANDING_SUBDIR = 'branding';
const BRANDING_DIR = path.join(DATA_FOLDER, BRANDING_SUBDIR);
const BRANDING_FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB
const BRANDING_ALLOWED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
]);

function isCustomBrandingPath(p: string | undefined): boolean {
  if (!p) return false;
  return p.startsWith(`/${BRANDING_SUBDIR}/`);
}

const SAFE_BRANDING_PATH = /^\/branding\/[A-Za-z0-9._-]+$/;
function isAllowedLogoPath(p: string): boolean {
  return p === defaultConfig.logoPath || SAFE_BRANDING_PATH.test(p);
}
function isAllowedFaviconPath(p: string): boolean {
  return p === defaultConfig.faviconPath || SAFE_BRANDING_PATH.test(p);
}

async function deleteCustomBrandingFile(brandingPath: string | undefined) {
  if (!isCustomBrandingPath(brandingPath)) return;
  const safeRelative = path.normalize(brandingPath as string).replace(/^[/\\]+/, '');
  const absolute = path.resolve(DATA_FOLDER, safeRelative);
  if (!absolute.startsWith(path.resolve(DATA_FOLDER) + path.sep)) return;
  await withError(unlink(absolute));
}

async function persistBrandingFile(
  kind: 'logo' | 'favicon' | 'linkIcon',
  uploaded: MultipartFile
): Promise<{ relativePath: string } | { error: string }> {
  const original = uploaded.filename ?? '';
  const ext = path.extname(original).toLowerCase();
  if (!BRANDING_ALLOWED_EXTENSIONS.has(ext)) {
    return { error: `Unsupported ${kind} file type: ${ext || '(none)'}` };
  }

  await mkdir(BRANDING_DIR, { recursive: true });

  const safeName = `${kind}-${randomUUID()}${ext}`;
  const absolute = path.join(BRANDING_DIR, safeName);

  const { error } = await withError(pipeline(uploaded.file, createWriteStream(absolute)));

  if (error) {
    await withError(unlink(absolute));
    const message = error instanceof Error ? error.message : 'write failed';
    return { error: `failed to save ${kind}: ${message}` };
  }

  if (uploaded.file.truncated) {
    await withError(unlink(absolute));
    return {
      error: `${kind} file exceeds ${BRANDING_FILE_SIZE_LIMIT / (1024 * 1024)} MB limit`,
    };
  }

  return { relativePath: `/${BRANDING_SUBDIR}/${safeName}` };
}

interface ConfigFormData {
  title?: string;
  serverBaseUrl?: string;
  logoPath?: string;
  logoInvertOnDark?: string;
  faviconPath?: string;
  reporterPaths?: string;
  headerLinks?: string;
  resultExpireDays?: string;
  resultExpireCronSchedule?: string;
  reportExpireDays?: string;
  reportExpireCronSchedule?: string;
  llmFeatureEnabled?: string;
  llmUseFallbackChain?: string;
  llmRouting?: string;
  llmAutoAnalyzeNewReports?: string;
  llmAutoProjectSummaryOnReportComplete?: string;
  llmAnalyzeGreenWindows?: string;
  llmGeneralContext?: string;
  llmCustomSystemPrompt?: string;
  llmCustomTestAnalysisSystemPrompt?: string;
  llmCustomProjectSummarySystemPrompt?: string;
  llmCustomTestAnalysisInstructions?: string;
  llmCustomReportSummaryPrompt?: string;
  llmCustomProjectSummaryInstructions?: string;
  llmCustomSynthesizerPrompt?: string;
  llmCustomJudgePrompt?: string;
  llmCustomCritiquePrompt?: string;
  llmCustomRevisePrompt?: string;
  llmCustomScorerPrompt?: string;
  llmScreenshotModel?: string;
  llmCustomScreenshotParsePrompt?: string;
  llmScreenshotSources?: string;
  llmMaxScreenshots?: string;
  testManagementQuarantineThresholdPercentage?: string;
  testManagementWarningThresholdPercentage?: string;
  testManagementAutoQuarantineEnabled?: string;
  testManagementFlakinessMinRuns?: string;
  testManagementFlakinessEvaluationWindowDays?: string;
}

// Explicit allow-list of accepted multipart field names. Anything not in this
// set is dropped, so we cannot smuggle __proto__/constructor/etc.
// into the formData object.
const ALLOWED_CONFIG_FIELDS: ReadonlySet<keyof ConfigFormData> = new Set<keyof ConfigFormData>([
  'title',
  'serverBaseUrl',
  'logoPath',
  'logoInvertOnDark',
  'faviconPath',
  'reporterPaths',
  'headerLinks',
  'resultExpireDays',
  'resultExpireCronSchedule',
  'reportExpireDays',
  'reportExpireCronSchedule',
  'llmFeatureEnabled',
  'llmUseFallbackChain',
  'llmRouting',
  'llmAutoAnalyzeNewReports',
  'llmAutoProjectSummaryOnReportComplete',
  'llmAnalyzeGreenWindows',
  'llmGeneralContext',
  'llmCustomSystemPrompt',
  'llmCustomTestAnalysisSystemPrompt',
  'llmCustomProjectSummarySystemPrompt',
  'llmCustomTestAnalysisInstructions',
  'llmCustomReportSummaryPrompt',
  'llmCustomProjectSummaryInstructions',
  'llmCustomSynthesizerPrompt',
  'llmCustomJudgePrompt',
  'llmCustomCritiquePrompt',
  'llmCustomRevisePrompt',
  'llmCustomScorerPrompt',
  'llmScreenshotModel',
  'llmCustomScreenshotParsePrompt',
  'llmScreenshotSources',
  'llmMaxScreenshots',
  'testManagementQuarantineThresholdPercentage',
  'testManagementWarningThresholdPercentage',
  'testManagementAutoQuarantineEnabled',
  'testManagementFlakinessMinRuns',
  'testManagementFlakinessEvaluationWindowDays',
]);

export async function registerConfigRoutes(fastify: FastifyInstance) {
  fastify.get('/api/config', async (request, reply) => {
    const { result: config, error } = await withError(service.getConfig());

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    if (!config) {
      return reply.status(500).send({ error: 'failed to get config' });
    }

    const isAuthed = await isAuthenticated(request as AuthRequest);

    reply.header('Cache-Control', 'private, max-age=10, must-revalidate');

    const publicConfig = {
      title: config.title,
      logoPath: config.logoPath,
      logoInvertOnDark: config.logoInvertOnDark !== false,
      faviconPath: config.faviconPath,
      headerLinks: config.headerLinks,
      authRequired: !!env.API_TOKEN,
    };

    if (!isAuthed) {
      return publicConfig;
    }

    const envInfo = {
      authRequired: !!env.API_TOKEN,
      database: getDatabaseStats(),
      dataStorage: env.DATA_STORAGE,
      s3Endpoint: env.S3_ENDPOINT,
      s3Bucket: env.S3_BUCKET,
      azureAccountName: env.AZURE_ACCOUNT_NAME,
      azureContainer: env.AZURE_CONTAINER,
    };

    const primaryModel = llmModelsDb.getPrimary();
    const featureEnabled = config.llm?.featureEnabled !== false;
    const llmInfo = {
      enabled: featureEnabled,
      configured: featureEnabled && !!primaryModel,
      primaryModel: primaryModel
        ? {
            id: primaryModel.id,
            label: primaryModel.label,
            provider: primaryModel.provider,
            model: primaryModel.model,
          }
        : null,
      useFallbackChain: !!config.llm?.useFallbackChain,
      routing: config.llm?.routing ?? {},
      autoAnalyzeNewReports: !!config.llm?.autoAnalyzeNewReports,
      autoProjectSummaryOnReportComplete: !!config.llm?.autoProjectSummaryOnReportComplete,
      analyzeGreenWindows: !!config.llm?.analyzeGreenWindows,
      generalContext: config.llm?.generalContext,
      customSystemPrompt: config.llm?.customSystemPrompt,
      customTestAnalysisSystemPrompt: config.llm?.customTestAnalysisSystemPrompt,
      customTestAnalysisInstructions: config.llm?.customTestAnalysisInstructions,
      customReportSummaryPrompt: config.llm?.customReportSummaryPrompt,
      customProjectSummarySystemPrompt: config.llm?.customProjectSummarySystemPrompt,
      customProjectSummaryInstructions: config.llm?.customProjectSummaryInstructions,
      customSynthesizerPrompt: config.llm?.customSynthesizerPrompt,
      customJudgePrompt: config.llm?.customJudgePrompt,
      customCritiquePrompt: config.llm?.customCritiquePrompt,
      customRevisePrompt: config.llm?.customRevisePrompt,
      customScorerPrompt: config.llm?.customScorerPrompt,
      screenshotModel: config.llm?.screenshotModel,
      customScreenshotParsePrompt: config.llm?.customScreenshotParsePrompt,
      screenshotSources: config.llm?.screenshotSources,
      maxScreenshots: config.llm?.maxScreenshots,
    };

    return { ...config, ...envInfo, llm: llmInfo };
  });

  fastify.patch(
    '/api/config',
    { preHandler: (request, reply) => authenticate(request as AuthRequest, reply) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Bumped from 2 to allow logo + favicon + one icon per header link.
        // 32 is plenty - anyone with that many header links has bigger problems.
        const parts = request.parts({
          limits: { files: 32, fileSize: BRANDING_FILE_SIZE_LIMIT },
        });

        const config = await service.getConfig();

        if (!config) {
          return reply.status(500).send({ error: 'failed to get config' });
        }

        const previousLogoPath = config.logoPath;
        const previousFaviconPath = config.faviconPath;
        const previousLinkIcons = new Set(
          (config.headerLinks ?? [])
            .map((l) => l.icon)
            .filter((icon): icon is string => !!icon && isCustomBrandingPath(icon))
        );

        const formData: ConfigFormData = {};
        let hasParts = false;
        let logoFileSaved: string | null = null;
        let faviconFileSaved: string | null = null;
        const linkIconsSaved = new Map<string, string>();

        for await (const part of parts) {
          hasParts = true;
          if (part.type === 'file') {
            const fieldname = part.fieldname;
            const isLinkIcon = fieldname.startsWith('linkIcon:');
            if (fieldname !== 'logo' && fieldname !== 'favicon' && !isLinkIcon) {
              part.file.resume();
              continue;
            }
            const kind: 'logo' | 'favicon' | 'linkIcon' = isLinkIcon
              ? 'linkIcon'
              : (fieldname as 'logo' | 'favicon');
            const result = await persistBrandingFile(kind, part as unknown as MultipartFile);
            if ('error' in result) {
              return reply.status(400).send({ error: result.error });
            }
            if (kind === 'logo') logoFileSaved = result.relativePath;
            else if (kind === 'favicon') faviconFileSaved = result.relativePath;
            else {
              const linkId = fieldname.slice('linkIcon:'.length);
              linkIconsSaved.set(linkId, result.relativePath);
            }
          } else if (part.type === 'field') {
            const fieldName = part.fieldname as keyof ConfigFormData;
            if (!ALLOWED_CONFIG_FIELDS.has(fieldName)) continue;
            formData[fieldName] = part.value as string;
          }
        }

        if (!hasParts) {
          return reply.status(400).send({ error: 'No data received' });
        }

        if (logoFileSaved) {
          config.logoPath = logoFileSaved;
        } else if (formData.logoPath !== undefined) {
          // Blank string resets to the built-in default so users can revert a
          // custom logo without re-uploading the original asset.
          const next = formData.logoPath.trim();
          if (next === '') {
            config.logoPath = defaultConfig.logoPath;
          } else if (!isAllowedLogoPath(next)) {
            return reply.status(400).send({ error: 'invalid logoPath' });
          } else {
            config.logoPath = next;
          }
        }

        if (formData.logoInvertOnDark !== undefined) {
          config.logoInvertOnDark = formData.logoInvertOnDark === 'true';
        }

        if (faviconFileSaved) {
          config.faviconPath = faviconFileSaved;
        } else if (formData.faviconPath !== undefined) {
          const next = formData.faviconPath.trim();
          if (next === '') {
            config.faviconPath = defaultConfig.faviconPath;
          } else if (!isAllowedFaviconPath(next)) {
            return reply.status(400).send({ error: 'invalid faviconPath' });
          } else {
            config.faviconPath = next;
          }
        }

        if (formData.title !== undefined) {
          config.title = formData.title.trim() === '' ? defaultConfig.title : formData.title;
        }

        if (formData.serverBaseUrl !== undefined) {
          const next = formData.serverBaseUrl.trim().replace(/\/+$/, '');
          if (next === '') {
            config.serverBaseUrl = '';
          } else if (!/^https?:\/\//i.test(next)) {
            return reply
              .status(400)
              .send({ error: 'serverBaseUrl must start with http:// or https://' });
          } else {
            config.serverBaseUrl = next;
          }
        }

        if (formData.reporterPaths !== undefined) {
          let raw: unknown;
          try {
            raw = JSON.parse(formData.reporterPaths);
          } catch {
            raw = [formData.reporterPaths];
          }
          const cleaned = normalizeReporterPaths(raw);
          const { missing } = validateReporterPaths(cleaned);
          if (missing.length > 0) {
            const details = missing
              .map(({ input, resolved }) => `"${input}" (looked at ${resolved})`)
              .join(', ');
            return reply.status(400).send({
              error: `reporter file not found: ${details}. Use an absolute path, or a path relative to the server's working directory.`,
            });
          }
          config.reporterPaths = cleaned;
        }

        if (formData.headerLinks !== undefined) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(formData.headerLinks);
          } catch (error) {
            return reply.status(400).send({
              error: `failed to parse header links: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
            });
          }
          if (!Array.isArray(parsed)) {
            return reply.status(400).send({ error: 'headerLinks must be an array' });
          }
          const sanitized: typeof config.headerLinks = [];
          for (const raw of parsed) {
            if (!raw || typeof raw !== 'object') {
              return reply.status(400).send({ error: 'header link entry must be an object' });
            }
            const entry = raw as {
              id?: unknown;
              label?: unknown;
              url?: unknown;
              icon?: unknown;
              showLabel?: unknown;
            };
            if (typeof entry.id !== 'string' || !entry.id) {
              return reply.status(400).send({ error: 'header link entry missing id' });
            }
            if (typeof entry.label !== 'string') {
              return reply.status(400).send({ error: 'header link entry missing label' });
            }
            if (typeof entry.url !== 'string') {
              return reply.status(400).send({ error: 'header link entry missing url' });
            }
            const iconRaw = typeof entry.icon === 'string' ? entry.icon : '';
            // If a file was uploaded for this link, prefer its saved path.
            const uploadedIcon = linkIconsSaved.get(entry.id);
            let icon: string | undefined;
            if (uploadedIcon) {
              icon = uploadedIcon;
            } else if (iconRaw?.startsWith('/branding/')) {
              if (!SAFE_BRANDING_PATH.test(iconRaw)) {
                return reply.status(400).send({ error: 'invalid header link icon path' });
              }
              icon = iconRaw;
            } else if (iconRaw) {
              icon = iconRaw;
            }
            sanitized.push({
              id: entry.id,
              label: entry.label,
              url: entry.url,
              icon,
              showLabel: entry.showLabel === true ? true : undefined,
            });
          }
          config.headerLinks = sanitized;
        } else if (linkIconsSaved.size > 0) {
          config.headerLinks = (config.headerLinks ?? []).map((link) => {
            const uploaded = linkIconsSaved.get(link.id);
            return uploaded ? { ...link, icon: uploaded } : link;
          });
        }

        config.llm ??= {};

        if (formData.llmFeatureEnabled !== undefined) {
          const enable = formData.llmFeatureEnabled === 'true';
          if (enable && !llmModelsDb.getPrimary()) {
            return reply.status(409).send({
              error: 'Set a primary model before enabling LLM features',
            });
          }
          config.llm ??= {};
          config.llm.featureEnabled = enable;
        }

        if (formData.llmUseFallbackChain !== undefined) {
          config.llm ??= {};
          config.llm.useFallbackChain = formData.llmUseFallbackChain === 'true';
        }

        if (formData.llmRouting !== undefined) {
          let parsedRouting: unknown;
          try {
            parsedRouting = JSON.parse(formData.llmRouting);
          } catch {
            return reply.status(400).send({ error: 'llmRouting must be valid JSON' });
          }
          const enabledIds = new Set(
            llmModelsDb
              .list()
              .filter((m) => m.enabled === 1)
              .map((m) => m.id)
          );
          const routingError = validateRouting(parsedRouting, enabledIds);
          if (routingError) return reply.status(400).send({ error: routingError });
          config.llm ??= {};
          config.llm.routing = parsedRouting as Partial<Record<LlmTaskType, LlmTaskRouting>>;
        }

        if (formData.llmAutoAnalyzeNewReports !== undefined) {
          config.llm.autoAnalyzeNewReports = formData.llmAutoAnalyzeNewReports === 'true';
        }

        if (formData.llmAutoProjectSummaryOnReportComplete !== undefined) {
          config.llm.autoProjectSummaryOnReportComplete =
            formData.llmAutoProjectSummaryOnReportComplete === 'true';
        }

        if (formData.llmAnalyzeGreenWindows !== undefined) {
          config.llm.analyzeGreenWindows = formData.llmAnalyzeGreenWindows === 'true';
        }

        if (formData.llmGeneralContext !== undefined) {
          const trimmed = formData.llmGeneralContext.trim();
          if (trimmed.length > 500) {
            return reply
              .status(400)
              .send({ error: 'LLM general context must be 500 characters or fewer' });
          }
          config.llm.generalContext = trimmed || undefined;
        }

        if (formData.llmCustomSystemPrompt !== undefined) {
          config.llm.customSystemPrompt = formData.llmCustomSystemPrompt || undefined;
        }
        if (formData.llmCustomTestAnalysisSystemPrompt !== undefined) {
          config.llm.customTestAnalysisSystemPrompt =
            formData.llmCustomTestAnalysisSystemPrompt || undefined;
        }
        if (formData.llmCustomProjectSummarySystemPrompt !== undefined) {
          config.llm.customProjectSummarySystemPrompt =
            formData.llmCustomProjectSummarySystemPrompt || undefined;
        }
        if (formData.llmCustomTestAnalysisInstructions !== undefined) {
          config.llm.customTestAnalysisInstructions =
            formData.llmCustomTestAnalysisInstructions || undefined;
        }
        if (formData.llmCustomReportSummaryPrompt !== undefined) {
          config.llm.customReportSummaryPrompt = formData.llmCustomReportSummaryPrompt || undefined;
        }
        if (formData.llmCustomProjectSummaryInstructions !== undefined) {
          config.llm.customProjectSummaryInstructions =
            formData.llmCustomProjectSummaryInstructions || undefined;
        }
        if (formData.llmCustomSynthesizerPrompt !== undefined) {
          config.llm.customSynthesizerPrompt = formData.llmCustomSynthesizerPrompt || undefined;
        }
        if (formData.llmCustomJudgePrompt !== undefined) {
          config.llm.customJudgePrompt = formData.llmCustomJudgePrompt || undefined;
        }
        if (formData.llmCustomCritiquePrompt !== undefined) {
          config.llm.customCritiquePrompt = formData.llmCustomCritiquePrompt || undefined;
        }
        if (formData.llmCustomRevisePrompt !== undefined) {
          config.llm.customRevisePrompt = formData.llmCustomRevisePrompt || undefined;
        }
        if (formData.llmCustomScorerPrompt !== undefined) {
          config.llm.customScorerPrompt = formData.llmCustomScorerPrompt || undefined;
        }

        if (formData.llmScreenshotModel !== undefined) {
          const modelId = formData.llmScreenshotModel.trim();
          if (modelId) {
            const isEnabled = llmModelsDb.list().some((m) => m.id === modelId && m.enabled === 1);
            if (!isEnabled) {
              return reply
                .status(400)
                .send({ error: 'llmScreenshotModel references an unknown or disabled model' });
            }
            config.llm.screenshotModel = { modelId };
          } else {
            config.llm.screenshotModel = undefined;
          }
        }
        if (formData.llmCustomScreenshotParsePrompt !== undefined) {
          config.llm.customScreenshotParsePrompt =
            formData.llmCustomScreenshotParsePrompt || undefined;
        }
        if (formData.llmScreenshotSources !== undefined) {
          const valid: LlmScreenshotSource[] = ['attachment', 'failing_action', 'series'];
          const parsed = formData.llmScreenshotSources
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          for (const s of parsed) {
            if (!valid.includes(s as LlmScreenshotSource)) {
              return reply
                .status(400)
                .send({ error: `llmScreenshotSources has invalid value "${s}"` });
            }
          }
          // de-dupe while preserving order; empty list = no screenshots (kept as []).
          config.llm.screenshotSources = [...new Set(parsed)] as LlmScreenshotSource[];
        }
        if (formData.llmMaxScreenshots !== undefined) {
          const raw = formData.llmMaxScreenshots.trim();
          const n = raw === '' ? Number.NaN : Number(raw);
          config.llm.maxScreenshots = Number.isFinite(n)
            ? Math.min(SCREENSHOTS_MAX_CAP, Math.max(1, Math.round(n)))
            : undefined;
        }

        config.cron ??= {};

        const parseExpireDays = (
          raw: string | undefined,
          field: string
        ): number | undefined | { error: string } => {
          if (raw === undefined) return undefined;
          const trimmed = raw.trim();
          if (trimmed === '') return undefined;
          const days = Number.parseInt(trimmed, 10);
          if (Number.isNaN(days) || days < 0) {
            return { error: `${field} must be a non-negative integer` };
          }
          return days;
        };
        if (formData.resultExpireDays !== undefined) {
          const parsed = parseExpireDays(formData.resultExpireDays, 'resultExpireDays');
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            return reply.status(400).send({ error: parsed.error });
          }
          config.cron.resultExpireDays = parsed as number | undefined;
        }
        if (formData.reportExpireDays !== undefined) {
          const parsed = parseExpireDays(formData.reportExpireDays, 'reportExpireDays');
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            return reply.status(400).send({ error: parsed.error });
          }
          config.cron.reportExpireDays = parsed as number | undefined;
        }
        const parseCronSchedule = (
          raw: string | undefined,
          field: string
        ): string | undefined | { error: string } => {
          if (raw === undefined) return undefined;
          const trimmed = raw.trim();
          if (trimmed === '') return undefined;
          const validation = CronService.validateExpression(trimmed);
          if (!validation.valid) {
            return { error: `${field} is invalid: ${validation.error}` };
          }
          return trimmed;
        };
        if (formData.resultExpireCronSchedule !== undefined) {
          const parsed = parseCronSchedule(
            formData.resultExpireCronSchedule,
            'resultExpireCronSchedule'
          );
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            return reply.status(400).send({ error: parsed.error });
          }
          config.cron.resultExpireCronSchedule = parsed as string | undefined;
        }
        if (formData.reportExpireCronSchedule !== undefined) {
          const parsed = parseCronSchedule(
            formData.reportExpireCronSchedule,
            'reportExpireCronSchedule'
          );
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            return reply.status(400).send({ error: parsed.error });
          }
          config.cron.reportExpireCronSchedule = parsed as string | undefined;
        }

        const cronConfigChanged =
          formData.resultExpireDays !== undefined ||
          formData.resultExpireCronSchedule !== undefined ||
          formData.reportExpireDays !== undefined ||
          formData.reportExpireCronSchedule !== undefined;

        config.testManagement ??= {};

        if (formData.testManagementQuarantineThresholdPercentage !== undefined) {
          const threshold = Number.parseInt(
            formData.testManagementQuarantineThresholdPercentage,
            10
          );
          if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
            return reply.status(400).send({
              error: 'Test management quarantine threshold must be a number between 0 and 100',
            });
          }
          config.testManagement.quarantineThresholdPercentage = threshold;
        }

        if (formData.testManagementWarningThresholdPercentage !== undefined) {
          const threshold = Number.parseInt(formData.testManagementWarningThresholdPercentage, 10);
          if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
            return reply.status(400).send({
              error: 'Test management warning threshold must be a number between 0 and 100',
            });
          }
          config.testManagement.warningThresholdPercentage = threshold;
        }

        if (formData.testManagementAutoQuarantineEnabled !== undefined) {
          config.testManagement.autoQuarantineEnabled =
            formData.testManagementAutoQuarantineEnabled === 'true';
        }

        if (formData.testManagementFlakinessMinRuns !== undefined) {
          const minRuns = Number.parseInt(formData.testManagementFlakinessMinRuns, 10);
          if (Number.isNaN(minRuns) || minRuns < 1) {
            return reply.status(400).send({
              error: 'Test management minimum runs must be a number greater than 0',
            });
          }
          config.testManagement.flakinessMinRuns = minRuns;
        }

        if (formData.testManagementFlakinessEvaluationWindowDays !== undefined) {
          const windowDays = Number.parseInt(
            formData.testManagementFlakinessEvaluationWindowDays,
            10
          );
          if (Number.isNaN(windowDays) || windowDays < 1) {
            return reply.status(400).send({
              error: 'Test management evaluation window must be a number of days greater than 0',
            });
          }
          config.testManagement.flakinessEvaluationWindowDays = windowDays;
        }

        if (logoFileSaved && isCustomBrandingPath(logoFileSaved)) {
          const { error } = await withError(storage.uploadBrandingAsset(logoFileSaved));
          if (error) {
            await withError(deleteCustomBrandingFile(logoFileSaved));
            return reply.status(500).send({
              error: `failed to upload logo: ${error.message}`,
            });
          }
        }
        if (faviconFileSaved && isCustomBrandingPath(faviconFileSaved)) {
          const { error } = await withError(storage.uploadBrandingAsset(faviconFileSaved));
          if (error) {
            await withError(deleteCustomBrandingFile(faviconFileSaved));
            return reply.status(500).send({
              error: `failed to upload favicon: ${error.message}`,
            });
          }
        }
        for (const iconPath of linkIconsSaved.values()) {
          if (!isCustomBrandingPath(iconPath)) continue;
          const { error } = await withError(storage.uploadBrandingAsset(iconPath));
          if (error) {
            await withError(deleteCustomBrandingFile(iconPath));
            return reply.status(500).send({
              error: `failed to upload link icon: ${error.message}`,
            });
          }
        }

        const { error: saveConfigError } = await withError(service.updateConfig(config));

        if (saveConfigError) {
          return reply.status(500).send({
            error: `failed to save config: ${saveConfigError.message}`,
          });
        }

        if (config.logoPath !== previousLogoPath) {
          await withError(deleteCustomBrandingFile(previousLogoPath));
          if (isCustomBrandingPath(previousLogoPath)) {
            await withError(storage.deleteBrandingAsset(previousLogoPath as string));
          }
        }
        if (config.faviconPath !== previousFaviconPath) {
          await withError(deleteCustomBrandingFile(previousFaviconPath));
          if (isCustomBrandingPath(previousFaviconPath)) {
            await withError(storage.deleteBrandingAsset(previousFaviconPath as string));
          }
        }

        const currentLinkIcons = new Set(
          (config.headerLinks ?? [])
            .map((l) => l.icon)
            .filter((icon): icon is string => !!icon && isCustomBrandingPath(icon))
        );
        for (const orphan of previousLinkIcons) {
          if (currentLinkIcons.has(orphan)) continue;
          await withError(deleteCustomBrandingFile(orphan));
          await withError(storage.deleteBrandingAsset(orphan));
        }

        const testManagementConfigChanged = !!(
          formData.testManagementQuarantineThresholdPercentage ||
          formData.testManagementWarningThresholdPercentage ||
          formData.testManagementAutoQuarantineEnabled !== undefined ||
          formData.testManagementFlakinessMinRuns ||
          formData.testManagementFlakinessEvaluationWindowDays
        );

        if (testManagementConfigChanged) {
          await testManagementService.recalculateAllFlakinessScores();
        }

        if (cronConfigChanged) {
          await cronService.restart();
        }

        return reply.send({ message: 'config saved' });
      } catch (error) {
        fastify.log.error({ error }, 'Config update error');
        return reply.status(400).send({
          error: `config update failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  );

  fastify.get(
    '/api/info',
    { preHandler: (request, reply) => authenticate(request as AuthRequest, reply) },
    async (_request, reply) => {
      const { result: info, error } = await withError(service.getServerInfo());

      if (error) {
        return reply.status(400).send({ error: error.message });
      }

      return info;
    }
  );
}
