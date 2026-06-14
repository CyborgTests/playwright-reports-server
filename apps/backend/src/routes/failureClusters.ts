import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  getFailureClusters,
  invalidateFailureClustersCache,
} from '../lib/failure-clustering/index.js';
import { ResolveClusterBodySchema, ResolveClusterParamsSchema } from '../lib/schemas/index.js';
import { clusterResolutionsDb } from '../lib/service/db/index.js';
import { ValidationError, validateSchema } from '../lib/validation/index.js';
import { withError } from '../lib/withError.js';
import { type AuthRequest, authenticate } from './auth.js';

export async function registerFailureClusterRoutes(fastify: FastifyInstance) {
  fastify.get('/api/analytics/failure-clusters', async (request, reply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const { project, from, to, reportId, testId, fileId, clusterId, includeResolved } =
      request.query as {
        project?: string;
        from?: string;
        to?: string;
        reportId?: string;
        testId?: string;
        fileId?: string;
        clusterId?: string;
        includeResolved?: string;
      };

    const { result: report, error } = await withError(
      getFailureClusters({
        project,
        from,
        to,
        reportId,
        testId,
        fileId,
        clusterId,
        includeResolved: includeResolved === '1' || includeResolved === 'true',
      })
    );

    if (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: `Failed to fetch failure clusters: ${error.message}`,
      });
    }

    return reply.send({ success: true, data: report });
  });

  const handleClusterMutation = async (
    request: FastifyRequest,
    reply: FastifyReply,
    apply: (clusterId: string) => void,
    failureMsg: string
  ) => {
    try {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;
      const { id } = validateSchema(ResolveClusterParamsSchema, request.params);
      apply(id);
      invalidateFailureClustersCache();
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.status(400).send({ error: error.message, details: error.details });
      }
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: `${failureMsg}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };

  fastify.post('/api/analytics/failure-clusters/:id/resolve', async (request, reply) =>
    handleClusterMutation(
      request,
      reply,
      (clusterId) => {
        const body = validateSchema(ResolveClusterBodySchema, request.body ?? {});
        clusterResolutionsDb.setOverride({ clusterId, state: 'resolved', ...body });
      },
      'Failed to mark cluster resolved'
    )
  );

  fastify.post('/api/analytics/failure-clusters/:id/reopen', async (request, reply) =>
    handleClusterMutation(
      request,
      reply,
      (clusterId) => {
        const body = validateSchema(ResolveClusterBodySchema, request.body ?? {});
        clusterResolutionsDb.setOverride({ clusterId, state: 'active', ...body });
      },
      'Failed to re-open cluster'
    )
  );
}
