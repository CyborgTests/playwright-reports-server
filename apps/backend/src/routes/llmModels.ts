import { randomUUID } from 'node:crypto';
import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decryptToken, encryptToken } from '../lib/githubSync/encryption.js';
import { deleteCircuit, resetCircuit } from '../lib/llm/circuitBreaker.js';
import { llmService } from '../lib/llm/index.js';
import { applyPrimaryModel, toLlmModel } from '../lib/llm/registry.js';
import { type LlmModelRow, llmGroupsDb, llmModelsDb } from '../lib/service/db/index.js';
import { authorize } from './auth.js';

const MASK_RE = /^\*+$/;

const ModelBodySchema = z.object({
  label: z.string().min(1, 'label is required'),
  provider: z.enum(['openai', 'anthropic']),
  baseUrl: z.string().min(1, 'baseUrl is required'),
  apiKey: z.string().optional(),
  model: z.string().min(1, 'model is required'),
  parallelRequests: z.number().int().min(1).max(10).optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  multimodalMode: z.enum(['auto', 'force', 'disabled']).optional(),
  testAnalysisTemperature: z.number().min(0).max(2).nullable().optional(),
  reportSummaryTemperature: z.number().min(0).max(2).nullable().optional(),
  projectSummaryTemperature: z.number().min(0).max(2).nullable().optional(),
  inputCostPerMTok: z.number().nonnegative().nullable().optional(),
  outputCostPerMTok: z.number().nonnegative().nullable().optional(),
  concurrencyGroupId: z.string().nullable().optional(),
});

const UpdateBodySchema = ModelBodySchema.partial().extend({
  enabled: z.boolean().optional(),
});

const ReorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1).max(100),
});

function nextSortOrder(): number {
  const rows = llmModelsDb.list();
  return rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.sortOrder)) + 1;
}

function groupExists(id: string | null | undefined): boolean {
  return !id || !!llmGroupsDb.get(id);
}

export async function registerLlmModelsRoutes(fastify: FastifyInstance) {
  await fastify.register(async (fastify) => {
    fastify.addHook('preHandler', authorize(CAPABILITIES.view));
    // The model registry is config - reads are allowed for any session (the queue
    // page shows model labels). Editing the registry is admin-only, but probing a
    // model connection is an operational action allowed for members.
    const llmConfig = { preHandler: authorize(CAPABILITIES.configLlm) };
    const testModel = { preHandler: authorize(CAPABILITIES.testLlmModel) };

    fastify.get('/api/config/llm-models', async () => {
      return llmModelsDb.list().map(toLlmModel);
    });

    fastify.post('/api/config/llm-models', llmConfig, async (request, reply) => {
      const parsed = ModelBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid' });
      }
      const b = parsed.data;
      if (!groupExists(b.concurrencyGroupId)) {
        return reply.status(400).send({ error: 'concurrency group not found' });
      }
      const now = new Date().toISOString();
      const row: LlmModelRow = {
        id: randomUUID(),
        label: b.label,
        provider: b.provider,
        baseUrl: b.baseUrl,
        apiKeyCipher: b.apiKey && !MASK_RE.test(b.apiKey) ? encryptToken(b.apiKey) : null,
        model: b.model,
        parallelRequests: b.parallelRequests ?? 1,
        maxTokens: b.maxTokens ?? null,
        contextWindow: b.contextWindow ?? null,
        multimodalMode: b.multimodalMode ?? 'auto',
        testAnalysisTemperature: b.testAnalysisTemperature ?? null,
        reportSummaryTemperature: b.reportSummaryTemperature ?? null,
        projectSummaryTemperature: b.projectSummaryTemperature ?? null,
        inputCostPerMTok: b.inputCostPerMTok ?? null,
        outputCostPerMTok: b.outputCostPerMTok ?? null,
        sortOrder: nextSortOrder(),
        isPrimary: 0,
        enabled: 0,
        concurrencyGroupId: b.concurrencyGroupId ?? null,
        lastTestedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      llmModelsDb.insert(row);
      return reply.status(201).send(toLlmModel(row));
    });

    fastify.post<{ Params: { id: string } }>(
      '/api/config/llm-models/:id/duplicate',
      llmConfig,
      async (request, reply) => {
        const src = llmModelsDb.get(request.params.id);
        if (!src) return reply.status(404).send({ error: 'model not found' });
        const now = new Date().toISOString();
        const copy: LlmModelRow = {
          ...src,
          id: randomUUID(),
          label: `${src.label} (copy)`,
          sortOrder: nextSortOrder(),
          isPrimary: 0,
          enabled: 0,
          lastTestedAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        };
        llmModelsDb.insert(copy);
        return reply.status(201).send(toLlmModel(copy));
      }
    );

    fastify.patch<{ Params: { id: string } }>(
      '/api/config/llm-models/:id',
      llmConfig,
      async (request, reply) => {
        const parsed = UpdateBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid' });
        }
        const existing = llmModelsDb.get(request.params.id);
        if (!existing) return reply.status(404).send({ error: 'model not found' });
        const b = parsed.data;
        if (b.concurrencyGroupId !== undefined && !groupExists(b.concurrencyGroupId)) {
          return reply.status(400).send({ error: 'concurrency group not found' });
        }

        let apiKeyCipher = existing.apiKeyCipher;
        if (b.apiKey !== undefined && !MASK_RE.test(b.apiKey)) {
          apiKeyCipher = b.apiKey ? encryptToken(b.apiKey) : null;
        }

        const connectionChanged =
          b.baseUrl !== undefined ||
          b.model !== undefined ||
          apiKeyCipher !== existing.apiKeyCipher;
        const nextLastTested = connectionChanged ? null : existing.lastTestedAt;

        const willEnable = b.enabled === true && existing.enabled === 0;
        if (willEnable && !nextLastTested) {
          return reply
            .status(400)
            .send({ error: 'Test the connection successfully before enabling this model' });
        }

        const next: Omit<LlmModelRow, 'id' | 'createdAt' | 'updatedAt'> = {
          label: b.label ?? existing.label,
          provider: b.provider ?? existing.provider,
          baseUrl: b.baseUrl ?? existing.baseUrl,
          apiKeyCipher,
          model: b.model ?? existing.model,
          parallelRequests: b.parallelRequests ?? existing.parallelRequests,
          maxTokens: b.maxTokens !== undefined ? b.maxTokens : existing.maxTokens,
          contextWindow: b.contextWindow !== undefined ? b.contextWindow : existing.contextWindow,
          multimodalMode: b.multimodalMode ?? existing.multimodalMode,
          testAnalysisTemperature:
            b.testAnalysisTemperature !== undefined
              ? b.testAnalysisTemperature
              : existing.testAnalysisTemperature,
          reportSummaryTemperature:
            b.reportSummaryTemperature !== undefined
              ? b.reportSummaryTemperature
              : existing.reportSummaryTemperature,
          projectSummaryTemperature:
            b.projectSummaryTemperature !== undefined
              ? b.projectSummaryTemperature
              : existing.projectSummaryTemperature,
          inputCostPerMTok:
            b.inputCostPerMTok !== undefined ? b.inputCostPerMTok : existing.inputCostPerMTok,
          outputCostPerMTok:
            b.outputCostPerMTok !== undefined ? b.outputCostPerMTok : existing.outputCostPerMTok,
          sortOrder: existing.sortOrder,
          isPrimary: existing.isPrimary,
          enabled: b.enabled !== undefined ? (b.enabled ? 1 : 0) : existing.enabled,
          concurrencyGroupId:
            b.concurrencyGroupId !== undefined ? b.concurrencyGroupId : existing.concurrencyGroupId,
          lastTestedAt: nextLastTested,
          lastError: existing.lastError,
        };
        llmModelsDb.update(request.params.id, next);

        if (connectionChanged || willEnable) resetCircuit(request.params.id);
        if (existing.isPrimary === 1) await applyPrimaryModel();
        return toLlmModel(llmModelsDb.get(request.params.id) as LlmModelRow);
      }
    );

    fastify.patch<{ Params: { id: string } }>(
      '/api/config/llm-models/:id/primary',
      llmConfig,
      async (request, reply) => {
        const model = llmModelsDb.get(request.params.id);
        if (!model) return reply.status(404).send({ error: 'model not found' });
        if (model.enabled !== 1) {
          return reply.status(409).send({ error: 'enable the model before making it primary' });
        }
        llmModelsDb.setPrimary(request.params.id);
        await applyPrimaryModel();
        return toLlmModel(llmModelsDb.get(request.params.id) as LlmModelRow);
      }
    );

    fastify.put('/api/config/llm-models/order', llmConfig, async (request, reply) => {
      const parsed = ReorderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'orderedIds must be a non-empty string array' });
      }
      const orderedIds = parsed.data.orderedIds;
      const currentIds = llmModelsDb.list().map((m) => m.id);
      const sameSet =
        orderedIds.length === currentIds.length &&
        new Set(orderedIds).size === orderedIds.length &&
        orderedIds.every((id) => currentIds.includes(id));
      if (!sameSet) {
        return reply.status(400).send({ error: 'orderedIds must list every model exactly once' });
      }
      return llmModelsDb.reorder(orderedIds).map(toLlmModel);
    });

    fastify.delete<{ Params: { id: string } }>(
      '/api/config/llm-models/:id',
      llmConfig,
      async (request, reply) => {
        const model = llmModelsDb.get(request.params.id);
        if (!model) return reply.status(404).send({ error: 'model not found' });
        if (model.isPrimary === 1) {
          return reply
            .status(409)
            .send({ error: 'cannot delete the primary model - make another model primary first' });
        }
        llmModelsDb.delete(request.params.id);
        deleteCircuit(request.params.id);
        return { id: request.params.id, deleted: true };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/config/llm-models/:id/test-connection',
      testModel,
      async (request, reply) => {
        const model = llmModelsDb.get(request.params.id);
        if (!model) return reply.status(404).send({ error: 'model not found' });

        const result = await llmService.testConnection({
          provider: model.provider as 'openai' | 'anthropic',
          baseUrl: model.baseUrl,
          apiKey: decryptToken(model.apiKeyCipher) ?? '',
          model: model.model,
        });

        if (result.success) {
          llmModelsDb.setLastTested(request.params.id, new Date().toISOString());
          resetCircuit(request.params.id);
        } else {
          llmModelsDb.setLastError(request.params.id, result.error ?? 'connection test failed');
        }
        return result;
      }
    );
  });
}
