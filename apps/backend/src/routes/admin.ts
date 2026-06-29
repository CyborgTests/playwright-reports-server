import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance } from 'fastify';
import { reportDb } from '../lib/service/db/index.js';
import { importLegacyData } from '../lib/service/legacyImport.js';
import { withError } from '../lib/withError.js';
import { authorize } from './auth.js';

export async function registerAdminRoutes(fastify: FastifyInstance) {
  // one-time, admin-only import of reports/results from the original file-based server.
  // Refuses to run unless the reports table is empty.
  fastify.post(
    '/api/admin/migrate-legacy',
    { preHandler: authorize(CAPABILITIES.configServer) },
    async (_request, reply) => {
      if (reportDb.getCount() > 0) {
        return reply.code(409).send({
          success: false,
          error: 'reports already exist; legacy migration only runs on an empty reports table',
        });
      }

      const { result: summary, error } = await withError(importLegacyData());
      if (error || !summary) {
        return reply
          .code(400)
          .send({ success: false, error: error?.message ?? 'legacy migration failed' });
      }

      return reply.code(200).send({ success: true, ...summary });
    }
  );
}
