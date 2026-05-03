import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { llmService } from '../lib/llm/index.js';
import { CronService, cronService } from '../lib/service/cron.js';
import { getDatabaseStats } from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { testManagementService } from '../lib/service/testManagement.js';
import { DATA_FOLDER } from '../lib/storage/constants.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

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

async function deleteCustomBrandingFile(brandingPath: string | undefined) {
  if (!isCustomBrandingPath(brandingPath)) return;
  const safeRelative = path.normalize(brandingPath as string).replace(/^[/\\]+/, '');
  const absolute = path.resolve(DATA_FOLDER, safeRelative);
  if (!absolute.startsWith(path.resolve(DATA_FOLDER) + path.sep)) return;
  await withError(unlink(absolute));
}

async function persistBrandingFile(
  kind: 'logo' | 'favicon',
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

  const {error} = await withError(pipeline(uploaded.file, createWriteStream(absolute)));

  if (error) {
    await withError(unlink(absolute))
    const message = error instanceof Error ? error.message : 'write failed';
    return { error: `failed to save ${kind}: ${message}` };
  }

  if (uploaded.file.truncated) {
    await withError(unlink(absolute))
    return {
      error: `${kind} file exceeds ${BRANDING_FILE_SIZE_LIMIT / (1024 * 1024)} MB limit`,
    };
  }

  return { relativePath: `/${BRANDING_SUBDIR}/${safeName}` };
}

interface ConfigFormData {
  title?: string;
  logoPath?: string;
  faviconPath?: string;
  reporterPaths?: string;
  headerLinks?: string;
  resultExpireDays?: string;
  resultExpireCronSchedule?: string;
  reportExpireDays?: string;
  reportExpireCronSchedule?: string;
  llmProvider?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  llmTemperature?: string;
  llmParallelRequests?: string;
  llmAutoAnalyzeNewReports?: string;
  testManagementQuarantineThresholdPercentage?: string;
  testManagementWarningThresholdPercentage?: string;
  testManagementAutoQuarantineEnabled?: string;
  testManagementFlakinessMinRuns?: string;
  testManagementFlakinessEvaluationWindowDays?: string;
}

export async function registerConfigRoutes(fastify: FastifyInstance) {
  fastify.get('/api/config', async (_request, reply) => {
    const { result: config, error } = await withError(service.getConfig());

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    if (!config) {
      return reply.status(500).send({ error: 'failed to get config' });
    }

    const maskString = (str: string | undefined) => {
      if (!str) return undefined;
      return '*'.repeat(str.length);
    };

    const envInfo = {
      authRequired: !!env.API_TOKEN,
      database: getDatabaseStats(),
      dataStorage: env.DATA_STORAGE,
      s3Endpoint: env.S3_ENDPOINT,
      s3Bucket: env.S3_BUCKET,
    };

    const llmInfo = {
      provider: config.llm?.provider || env.LLM_PROVIDER,
      baseUrl: config.llm?.baseUrl || env.LLM_BASE_URL,
      apiKey: maskString(config.llm?.apiKey || env.LLM_API_KEY),
      model: config.llm?.model || env.LLM_MODEL,
      temperature:
        config.llm?.temperature ??
        (env.LLM_TEMPERATURE ? Number.parseFloat(String(env.LLM_TEMPERATURE)) : undefined),
      parallelRequests: config.llm?.parallelRequests || 1,
      autoAnalyzeNewReports: !!config.llm?.autoAnalyzeNewReports,
    };

    return { ...config, ...envInfo, llm: llmInfo };
  });

  fastify.patch('/api/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return authResult;

      const parts = request.parts({
        limits: { files: 2, fileSize: BRANDING_FILE_SIZE_LIMIT },
      });

      const config = await service.getConfig();

      if (!config) {
        return reply.status(500).send({ error: 'failed to get config' });
      }

      const previousLogoPath = config.logoPath;
      const previousFaviconPath = config.faviconPath;

      const formData: ConfigFormData = {};
      let hasParts = false;
      let logoFileSaved: string | null = null;
      let faviconFileSaved: string | null = null;

      for await (const part of parts) {
        hasParts = true;
        if (part.type === 'file') {
          if (part.fieldname !== 'logo' && part.fieldname !== 'favicon') {
            part.file.resume();
            continue;
          }
          const kind = part.fieldname;
          const result = await persistBrandingFile(kind, part as unknown as MultipartFile);
          if ('error' in result) {
            return reply.status(400).send({ error: result.error });
          }
          if (kind === 'logo') logoFileSaved = result.relativePath;
          else faviconFileSaved = result.relativePath;
        } else if (part.type === 'field') {
          const fieldName = part.fieldname as keyof ConfigFormData;
          formData[fieldName] = part.value as string;
        }
      }

      if (!hasParts) {
        return reply.status(400).send({ error: 'No data received' });
      }

      if (logoFileSaved) {
        config.logoPath = logoFileSaved;
      } else if (formData.logoPath !== undefined) {
        config.logoPath = formData.logoPath;
      }

      if (faviconFileSaved) {
        config.faviconPath = faviconFileSaved;
      } else if (formData.faviconPath !== undefined) {
        config.faviconPath = formData.faviconPath;
      }

      if (formData.title !== undefined && formData.title !== '') {
        config.title = formData.title;
      }

      if (formData.reporterPaths !== undefined) {
        try {
          config.reporterPaths = JSON.parse(formData.reporterPaths);
        } catch {
          config.reporterPaths = [formData.reporterPaths];
        }
      }

      if (formData.headerLinks !== undefined) {
        try {
          const parsedHeaderLinks = JSON.parse(formData.headerLinks);
          if (parsedHeaderLinks) config.headerLinks = parsedHeaderLinks;
        } catch (error) {
          return reply.status(400).send({
            error: `failed to parse header links: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
          });
        }
      }

      config.llm ??= {};

      if (formData.llmProvider !== undefined) {
        const provider = formData.llmProvider;
        config.llm.provider = provider as any;
      }
      if (formData.llmBaseUrl !== undefined) config.llm.baseUrl = formData.llmBaseUrl;
      if (formData.llmApiKey !== undefined) config.llm.apiKey = formData.llmApiKey;
      if (formData.llmModel !== undefined) config.llm.model = formData.llmModel;
      if (formData.llmTemperature !== undefined) {
        const temperature = Number.parseFloat(formData.llmTemperature);
        if (Number.isNaN(temperature)) {
          return reply.status(400).send({
            error: 'LLM temperature must be a number between 0 and 2',
          });
        }
        config.llm.temperature = temperature;
      }

      if (formData.llmParallelRequests !== undefined) {
        const parallelRequests = Number.parseInt(formData.llmParallelRequests, 10);
        if (Number.isNaN(parallelRequests) || parallelRequests < 1 || parallelRequests > 10) {
          return reply
            .status(400)
            .send({ error: 'LLM parallel requests must be between 1 and 10' });
        }
        config.llm ??= {};
        config.llm.parallelRequests = parallelRequests;
      }

      if (formData.llmAutoAnalyzeNewReports !== undefined) {
        config.llm.autoAnalyzeNewReports = formData.llmAutoAnalyzeNewReports === 'true';
      }

      const llmConfigChanged = !!(
        formData.llmProvider ||
        formData.llmBaseUrl ||
        formData.llmApiKey ||
        formData.llmModel ||
        formData.llmTemperature !== undefined
      );

      if (llmConfigChanged) {
        await llmService.restart(config.llm);
      }

      config.cron ??= {};

      if (formData.resultExpireDays !== undefined) {
        config.cron.resultExpireDays = Number.parseInt(formData.resultExpireDays, 10);
      }
      if (formData.resultExpireCronSchedule !== undefined) {
        config.cron.resultExpireCronSchedule = formData.resultExpireCronSchedule;
      }
      if (formData.reportExpireDays !== undefined) {
        config.cron.reportExpireDays = Number.parseInt(formData.reportExpireDays, 10);
      }
      if (formData.reportExpireCronSchedule !== undefined) {
        config.cron.reportExpireCronSchedule = formData.reportExpireCronSchedule;
      }

      if (
        formData.resultExpireDays ||
        formData.resultExpireCronSchedule ||
        formData.reportExpireDays ||
        formData.reportExpireCronSchedule
      ) {
        const instance = CronService.getInstance();
        await instance.restart();
      }

      config.testManagement ??= {};

      if (formData.testManagementQuarantineThresholdPercentage !== undefined) {
        const threshold = Number.parseInt(formData.testManagementQuarantineThresholdPercentage, 10);
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

      const { error: saveConfigError } = await withError(service.updateConfig(config));

      if (saveConfigError) {
        return reply.status(500).send({
          error: `failed to save config: ${saveConfigError.message}`,
        });
      }

      if (config.logoPath !== previousLogoPath) {
        await withError(deleteCustomBrandingFile(previousLogoPath))
      }
      if (config.faviconPath !== previousFaviconPath) {
        await withError(deleteCustomBrandingFile(previousFaviconPath))
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

      if (
        config.cron?.resultExpireDays ||
        config.cron?.resultExpireCronSchedule ||
        config.cron?.reportExpireDays ||
        config.cron?.reportExpireCronSchedule
      ) {
        await cronService.restart();
      }

      return reply.send({ message: 'config saved' });
    } catch (error) {
      fastify.log.error({ error }, 'Config update error');
      return reply.status(400).send({
        error: `config update failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });

  fastify.get('/api/info', async (_request, reply) => {
    const { result: info, error } = await withError(service.getServerInfo());

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    return info;
  });
}
