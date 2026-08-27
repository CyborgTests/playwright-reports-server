import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CleanupConfirmRequestSchema, CleanupEstimatesQuerySchema } from '../lib/schemas/index.js';
import { cronService } from '../lib/service/cron.js';
import { service } from '../lib/service/index.js';
import { ValidationError, validateSchema } from '../lib/validation/index.js';
import { authorize } from './auth.js';

function badRequest(reply: FastifyReply, error: unknown, context: string): FastifyReply {
  if (error instanceof ValidationError) {
    return reply.status(400).send({ success: false, error: error.message, issues: error.details });
  }
  console.error(`[routes] ${context} error:`, error);
  return reply.status(500).send({ success: false, error: 'Internal server error' });
}

export async function registerCleanupRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/config/cleanup-estimates',
    { preHandler: authorize(CAPABILITIES.configServer) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const windows = validateSchema(CleanupEstimatesQuerySchema, request.query);
        return { estimates: await service.getCleanupEstimates(windows) };
      } catch (error) {
        return badRequest(reply, error, 'cleanup estimates');
      }
    }
  );

  fastify.post(
    '/api/config/cleanup-confirm',
    { preHandler: authorize(CAPABILITIES.configServer) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { kind, days } = validateSchema(CleanupConfirmRequestSchema, request.body);

        const { confirmed, error } = await service.confirmCleanup(kind, days);
        if (!confirmed) return reply.status(409).send({ success: false, error });
        await cronService.restart();
        return { success: true };
      } catch (error) {
        return badRequest(reply, error, 'cleanup confirm');
      }
    }
  );
}
