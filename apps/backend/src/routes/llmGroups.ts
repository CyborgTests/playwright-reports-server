import { randomUUID } from 'node:crypto';
import type { LlmConcurrencyGroup } from '@playwright-reports/shared';
import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { llmAnalysisQueue } from '../lib/llm/queue/index.js';
import { type LlmConcurrencyGroupRow, llmGroupsDb } from '../lib/service/db/index.js';
import { authorize } from './auth.js';

const GroupBodySchema = z.object({
  name: z.string().min(1, 'name is required').max(60),
  concurrencyLimit: z.number().int().min(1).max(100),
});

function toGroup(row: LlmConcurrencyGroupRow, memberCount: number): LlmConcurrencyGroup {
  return {
    id: row.id,
    name: row.name,
    concurrencyLimit: row.concurrencyLimit,
    memberCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function registerLlmGroupsRoutes(fastify: FastifyInstance) {
  await fastify.register(async (fastify) => {
    // Reading groups is a view-level operation (the LLM settings section is
    // visible to members); only mutations require config:llm.
    fastify.addHook('preHandler', authorize(CAPABILITIES.view));
    const llmConfig = { preHandler: authorize(CAPABILITIES.configLlm) };

    fastify.get('/api/config/llm-groups', async () => {
      const counts = llmGroupsDb.memberCounts();
      return llmGroupsDb.list().map((g) => toGroup(g, counts.get(g.id) ?? 0));
    });

    fastify.post('/api/config/llm-groups', llmConfig, async (request, reply) => {
      const parsed = GroupBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid' });
      }
      const name = parsed.data.name.trim();
      if (llmGroupsDb.getByName(name)) {
        return reply.status(409).send({ error: 'a group with that name already exists' });
      }
      const now = new Date().toISOString();
      const row: LlmConcurrencyGroupRow = {
        id: randomUUID(),
        name,
        concurrencyLimit: parsed.data.concurrencyLimit,
        createdAt: now,
        updatedAt: now,
      };
      llmGroupsDb.insert(row);
      return reply.status(201).send(toGroup(row, 0));
    });

    fastify.patch<{ Params: { id: string } }>(
      '/api/config/llm-groups/:id',
      llmConfig,
      async (request, reply) => {
        const parsed = GroupBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid' });
        }
        const existing = llmGroupsDb.get(request.params.id);
        if (!existing) return reply.status(404).send({ error: 'group not found' });
        const name = parsed.data.name.trim();
        const clash = llmGroupsDb.getByName(name);
        if (clash && clash.id !== existing.id) {
          return reply.status(409).send({ error: 'a group with that name already exists' });
        }
        llmGroupsDb.update(existing.id, { name, concurrencyLimit: parsed.data.concurrencyLimit });
        llmAnalysisQueue.notifyConfigChanged();
        const counts = llmGroupsDb.memberCounts();
        const updated = llmGroupsDb.get(existing.id) as LlmConcurrencyGroupRow;
        return toGroup(updated, counts.get(updated.id) ?? 0);
      }
    );

    fastify.delete<{ Params: { id: string } }>(
      '/api/config/llm-groups/:id',
      llmConfig,
      async (request, reply) => {
        const existing = llmGroupsDb.get(request.params.id);
        if (!existing) return reply.status(404).send({ error: 'group not found' });
        llmGroupsDb.delete(existing.id);
        llmAnalysisQueue.notifyConfigChanged();
        return { id: existing.id, deleted: true };
      }
    );
  });
}
