import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance } from 'fastify';
import { reportDb } from '../lib/service/db/index.js';
import { getLegacyImportStatus, startLegacyImport } from '../lib/service/legacyImport.js';
import { authorize } from './auth.js';

export async function registerAdminRoutes(fastify: FastifyInstance) {
  // one-time, admin-only import of reports/results from the original file-based server.
  // Refuses to start unless the reports table is empty.
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

      const { started, reason } = startLegacyImport();
      if (!started) {
        return reply.code(409).send({ success: false, error: reason ?? 'already running' });
      }
      return reply.code(202).send({ success: true, started: true });
    }
  );

  fastify.get(
    '/api/admin/migrate-legacy/status',
    { preHandler: authorize(CAPABILITIES.configServer) },
    async () => ({ success: true, status: getLegacyImportStatus() })
  );
}
