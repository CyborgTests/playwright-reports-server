import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance } from 'fastify';
import {
  getFailureClusters,
  invalidateFailureClustersCache,
} from '../lib/failure-clustering/index.js';
import { ResolveClusterBodySchema, ResolveClusterParamsSchema } from '../lib/schemas/index.js';
import { clusterResolutionsDb, regressionsDb } from '../lib/service/db/index.js';
import { ValidationError, validateSchema } from '../lib/validation/index.js';
import { withError } from '../lib/withError.js';
import { authorize } from './auth.js';

export async function registerFailureClusterRoutes(fastify: FastifyInstance) {
  fastify.get('/api/analytics/failure-clusters', async (request, reply) => {
    const authResult = await authorize(CAPABILITIES.view)(request, reply);
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

  fastify.post('/api/analytics/failure-clusters/:id/resolve', async (request, reply) => {
    try {
      const authResult = await authorize(CAPABILITIES.contentClusters)(request, reply);
      if (authResult) return;
      const { id } = validateSchema(ResolveClusterParamsSchema, request.params);
      const body = validateSchema(ResolveClusterBodySchema, request.body ?? {});

      clusterResolutionsDb.setOverride({ clusterId: id, state: 'resolved', ...body });

      const { result: report, error: lookupError } = await withError(
        getFailureClusters({ project: body.project, clusterId: id, includeResolved: true })
      );
      if (lookupError) {
        fastify.log.warn(
          `Cluster ${id} resolved, but member-regression close skipped: ${lookupError.message}`
        );
      } else {
        const cluster = report?.clusters.find((c) => c.id === id);
        if (cluster) {
          regressionsDb.manuallyCloseForTests(
            cluster.tests.map((t) => ({
              testId: t.testId,
              fileId: t.fileId,
              project: t.project,
            })),
            new Date().toISOString()
          );
        }
      }

      invalidateFailureClustersCache();
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.status(400).send({ error: error.message, details: error.details });
      }
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: `Failed to mark cluster resolved: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  fastify.post('/api/analytics/failure-clusters/:id/reopen', async (request, reply) => {
    try {
      const authResult = await authorize(CAPABILITIES.contentClusters)(request, reply);
      if (authResult) return;
      const { id } = validateSchema(ResolveClusterParamsSchema, request.params);
      const body = validateSchema(ResolveClusterBodySchema, request.body ?? {});
      clusterResolutionsDb.setOverride({ clusterId: id, state: 'active', ...body });
      invalidateFailureClustersCache();
      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.status(400).send({ error: error.message, details: error.details });
      }
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: `Failed to re-open cluster: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
}
