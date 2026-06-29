import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pageResponse, parsePageQuery } from '../lib/pagination.js';
import { authAuditDb, usersDb } from '../lib/service/db/index.js';
import { authorize } from './auth.js';

export async function registerAuditRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/audit',
    { preHandler: authorize(CAPABILITIES.manageUsers) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { page, limit, offset } = parsePageQuery(request.query);
      const { action, actor, from, to } = request.query as {
        action?: string;
        actor?: string;
        from?: string;
        to?: string;
      };

      const { rows, total } = authAuditDb.list({ action, actor, from, to, limit, offset });

      const labels = new Map<string, string>();
      for (const row of rows) {
        for (const value of [row.actor, row.target]) {
          if (value && !labels.has(value)) {
            labels.set(value, usersDb.getUserById(value)?.username ?? value);
          }
        }
      }

      const data = rows.map((row) => ({
        id: row.id,
        ts: row.ts,
        action: row.action,
        actor: row.actor ? (labels.get(row.actor) ?? row.actor) : null,
        target: row.target ? (labels.get(row.target) ?? row.target) : null,
        detail: row.detail,
      }));

      return reply.send(pageResponse(data, total, page, limit));
    }
  );
}
