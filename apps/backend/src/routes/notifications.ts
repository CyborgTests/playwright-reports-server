import type { NotificationsConfig } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  NotificationLogDeleteSchema,
  NotificationLogQuerySchema,
  NotificationsConfigSchema,
  NotificationTestRequestSchema,
} from '../lib/schemas/index.js';
import { notificationLogDb } from '../lib/service/db/index.js';
import { service } from '../lib/service/index.js';
import { notificationScheduler } from '../lib/service/notifications/scheduler.js';
import { maskNotifications, mergeWithStored } from '../lib/service/notifications/secrets.js';
import { sendTest } from '../lib/service/notifications/testSend.js';
import { type AuthRequest, authenticate } from './auth.js';

const EMPTY_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  enabled: false,
  channels: [],
};

export async function registerNotificationsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/config/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const config = await service.getConfig();
    const notifications: NotificationsConfig = config.notifications ?? EMPTY_NOTIFICATIONS_CONFIG;

    return reply.send({ success: true, data: maskNotifications(notifications) });
  });

  fastify.put('/api/config/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const parsed = NotificationsConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid notifications config',
        issues: parsed.error.issues,
      });
    }

    const stored = (await service.getConfig()).notifications;
    const merged = mergeWithStored(parsed.data, stored);
    const updated = await service.updateConfig({ notifications: merged });

    try {
      notificationScheduler.reload(updated.notifications);
    } catch (err) {
      request.log.warn(
        `notification scheduler reload failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return reply.send({
      success: true,
      data: maskNotifications(updated.notifications ?? EMPTY_NOTIFICATIONS_CONFIG),
    });
  });

  fastify.get('/api/notifications/log', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const parsed = NotificationLogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid query',
        issues: parsed.error.issues,
      });
    }

    const { rows, total } = notificationLogDb.list(parsed.data);
    const last24h = notificationLogDb.last24h();

    return reply.send({
      success: true,
      data: { rows, total, last24h },
    });
  });

  fastify.delete(
    '/api/notifications/log/:id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;

      const { id } = (request.params ?? {}) as { id?: string };
      if (!id) {
        return reply.status(400).send({ success: false, error: 'Missing id' });
      }
      const removed = notificationLogDb.deleteById(id);
      return reply.send({ success: true, data: { removed } });
    }
  );

  fastify.post(
    '/api/notifications/log/delete',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = await authenticate(request as AuthRequest, reply);
      if (authResult) return;

      const parsed = NotificationLogDeleteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid delete request',
          issues: parsed.error.issues,
        });
      }
      const removed = notificationLogDb.deleteByIds(parsed.data.ids);
      return reply.send({ success: true, data: { removed } });
    }
  );

  fastify.post('/api/notifications/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authenticate(request as AuthRequest, reply);
    if (authResult) return;

    const parsed = NotificationTestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid test request',
        issues: parsed.error.issues,
      });
    }

    const config = (await service.getConfig()).notifications;
    const outcome = await sendTest({
      config,
      channelId: parsed.data.channelId,
      ruleIds: parsed.data.ruleIds,
      rule: parsed.data.rule,
      reportId: parsed.data.reportId,
    });

    if (!outcome.ok && outcome.error && outcome.results.length === 0) {
      return reply.status(400).send({ success: false, error: outcome.error });
    }

    return reply.send({
      success: true,
      data: { results: outcome.results, allOk: outcome.ok },
    });
  });
}
