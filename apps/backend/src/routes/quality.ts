import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { DashboardNameConflictError } from '../lib/service/db/index.js';
import { qualityDashboardsService } from '../lib/service/qualityDashboards.js';
import { type AuthRequest, authenticate } from './auth.js';

const GradeSchema = z.enum(['S', 'A', 'B', 'C', 'D', 'F']);
const FormulaSchema = z.enum(['strict', 'lenient']);
const GradeBandsSchema = z.object({
  S: z.number().min(0).max(100),
  A: z.number().min(0).max(100),
  B: z.number().min(0).max(100),
  C: z.number().min(0).max(100),
  D: z.number().min(0).max(100),
});

const DashboardCreateSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, or dashes')
    .optional(),
  isDefault: z.boolean().optional(),
  homeOrder: z.number().int().min(0).max(10000).optional(),
  stalenessDays: z.number().int().min(0).max(365).optional(),
  defaultGradeBands: GradeBandsSchema.optional(),
  defaultFormula: FormulaSchema.optional(),
  defaultMinOkGrade: GradeSchema.optional(),
});

const DashboardUpdateSchema = DashboardCreateSchema.partial();

const ReorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1).max(100),
});

const NodeInputSchema = z.object({
  id: z.string().optional(),
  parentNodeId: z.string().nullable(),
  kind: z.enum(['group', 'project']),
  name: z.string().min(1).max(120),
  projectName: z.string().nullable().optional(),
  weight: z.number().min(0).max(1000),
  sortOrder: z.number().int(),
  gradeBands: GradeBandsSchema.nullable().optional(),
  formula: FormulaSchema.nullable().optional(),
  minOkGrade: GradeSchema.nullable().optional(),
});

const TreeReplaceSchema = z.object({
  nodes: z.array(NodeInputSchema),
});

function handleAuth(request: FastifyRequest, reply: FastifyReply) {
  return authenticate(request as AuthRequest, reply);
}

export async function registerQualityRoutes(fastify: FastifyInstance) {
  fastify.get('/api/quality/dashboards', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await handleAuth(request, reply);
    if (authResult) return;

    const dashboards = qualityDashboardsService.listDashboards();
    return reply.send({ success: true, data: dashboards });
  });

  fastify.get(
    '/api/quality/dashboards/:slug',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await handleAuth(request, reply);
      if (authResult) return;

      const { slug } = request.params as { slug: string };
      const config = qualityDashboardsService.getConfigBySlug(slug);
      if (!config) {
        return reply.status(404).send({ success: false, error: 'Dashboard not found' });
      }
      return reply.send({ success: true, data: config });
    }
  );

  fastify.get(
    '/api/quality/dashboards/:slug/snapshot',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await handleAuth(request, reply);
      if (authResult) return;

      const { slug } = request.params as { slug: string };
      const snapshot = qualityDashboardsService.getSnapshotBySlug(slug);
      if (!snapshot) {
        return reply.status(404).send({ success: false, error: 'Dashboard not found' });
      }
      return reply.send({ success: true, data: snapshot });
    }
  );

  fastify.post('/api/quality/dashboards', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await handleAuth(request, reply);
    if (authResult) return;

    const parsed = DashboardCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: 'Invalid input', issues: parsed.error.issues });
    }

    try {
      const created = qualityDashboardsService.createDashboard(parsed.data);
      return reply.send({ success: true, data: created });
    } catch (err) {
      if (err instanceof DashboardNameConflictError) {
        return reply.status(409).send({ success: false, error: err.message });
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE') && message.includes('slug')) {
        return reply
          .status(409)
          .send({ success: false, error: 'A dashboard with that slug already exists' });
      }
      request.log.error({ err: message }, 'create dashboard failed');
      return reply.status(500).send({ success: false, error: 'Failed to create dashboard' });
    }
  });

  fastify.patch(
    '/api/quality/dashboards/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await handleAuth(request, reply);
      if (authResult) return;

      const { id } = request.params as { id: string };
      const parsed = DashboardUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Invalid input', issues: parsed.error.issues });
      }

      try {
        const updated = qualityDashboardsService.updateDashboard(id, parsed.data);
        if (!updated) {
          return reply.status(404).send({ success: false, error: 'Dashboard not found' });
        }
        return reply.send({ success: true, data: updated });
      } catch (err) {
        if (err instanceof DashboardNameConflictError) {
          return reply.status(409).send({ success: false, error: err.message });
        }
        const message = err instanceof Error ? err.message : String(err);
        request.log.error({ err: message }, 'update dashboard failed');
        return reply.status(500).send({ success: false, error: 'Failed to update dashboard' });
      }
    }
  );

  fastify.delete(
    '/api/quality/dashboards/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await handleAuth(request, reply);
      if (authResult) return;

      const { id } = request.params as { id: string };
      const removed = qualityDashboardsService.deleteDashboard(id);
      if (!removed) {
        return reply.status(404).send({ success: false, error: 'Dashboard not found' });
      }
      return reply.send({ success: true });
    }
  );

  fastify.put(
    '/api/quality/dashboards/:id/tree',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await handleAuth(request, reply);
      if (authResult) return;

      const { id } = request.params as { id: string };
      const parsed = TreeReplaceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Invalid input', issues: parsed.error.issues });
      }

      for (const node of parsed.data.nodes) {
        if (node.kind === 'project' && !node.projectName) {
          return reply.status(400).send({
            success: false,
            error: `Project node "${node.name}" missing projectName`,
          });
        }
      }

      try {
        const nodes = qualityDashboardsService.replaceTree(id, parsed.data.nodes);
        return reply.send({ success: true, data: { nodes } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Cyclic') || message.includes('parentNodeId')) {
          return reply.status(400).send({ success: false, error: message });
        }
        if (message.includes('not found')) {
          return reply.status(404).send({ success: false, error: message });
        }
        request.log.error({ err: message }, 'replace tree failed');
        return reply.status(500).send({ success: false, error: 'Failed to save tree' });
      }
    }
  );

  fastify.get('/api/quality/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await handleAuth(request, reply);
    if (authResult) return;

    const projects = qualityDashboardsService.listProjects();
    return reply.send({ success: true, data: projects });
  });

  fastify.get('/api/quality/home', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await handleAuth(request, reply);
    if (authResult) return;

    const snapshots = qualityDashboardsService.getHomeSnapshots();
    return reply.send({ success: true, data: snapshots });
  });

  fastify.put('/api/quality/home/order', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await handleAuth(request, reply);
    if (authResult) return;

    const parsed = ReorderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ success: false, error: 'Invalid input', issues: parsed.error.issues });
    }

    const pinned = qualityDashboardsService.reorderPinned(parsed.data.orderedIds);
    return reply.send({ success: true, data: pinned });
  });
}
