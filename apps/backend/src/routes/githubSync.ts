import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { githubSyncConfigService } from '../lib/githubSync/configService.js';
import { githubSyncCron } from '../lib/githubSync/cronManager.js';
import { githubSyncEvents } from '../lib/githubSync/events.js';
import { hasActiveRun, isRunning, runSync, stopSync } from '../lib/githubSync/syncService.js';
import { CronService } from '../lib/service/cron.js';
import { openSseStream } from '../lib/sse.js';
import { authorize } from './auth.js';

const ConfigBodySchema = z.object({
  name: z.string().min(1, 'name is required'),
  enabled: z.boolean().optional(),
  repo: z
    .string()
    .min(1)
    .regex(/^[^\s/]+\/[^\s/]+$/, 'repo must be in "owner/name" format'),
  workflow: z.string().min(1, 'workflow is required'),
  token: z.string().optional(),
  startDate: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}/,
      'startDate must be an ISO date or datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)'
    ),
  artifactPattern: z.string().min(1, 'artifactPattern is required'),
  projectTemplate: z.string().min(1, 'projectTemplate is required'),
  titleTemplate: z.string().optional(),
  cronSchedule: z.string().min(1, 'cronSchedule is required'),
});

const UpdateBodySchema = ConfigBodySchema.partial();
const EnabledBodySchema = z.object({ enabled: z.boolean() });

function validateRuntime(body: z.infer<typeof ConfigBodySchema>): string | undefined {
  try {
    new RegExp(body.artifactPattern);
  } catch (e) {
    return `artifactPattern is not a valid regex: ${e instanceof Error ? e.message : String(e)}`;
  }
  const cronCheck = CronService.validateExpression(body.cronSchedule);
  if (!cronCheck.valid) return `cronSchedule is invalid: ${cronCheck.error}`;
  if (Number.isNaN(Date.parse(body.startDate))) return 'startDate is not a valid date';
  return undefined;
}

export async function registerGithubSyncRoutes(fastify: FastifyInstance) {
  await fastify.register(async (fastify) => {
    fastify.addHook('preHandler', authorize(CAPABILITIES.view));
    // Editing sync configs is admin-only; viewing and running/stopping a sync are
    // operational actions allowed for any user.
    const cfgGuard = { preHandler: authorize(CAPABILITIES.configGithubSync) };
    const runGuard = { preHandler: authorize(CAPABILITIES.runGithubSync) };

    fastify.get('/api/config/github-sync', async () => {
      return githubSyncConfigService.listWithStatus((id) => githubSyncCron.nextRun(id));
    });

    fastify.get('/api/config/github-sync/events', async (request, reply) => {
      // Custom cadence: poll every 1s while a sync is running, otherwise a
      // 30s comment heartbeat — so the helper's fixed keepalive is opted out.
      const stream = openSseStream(fastify, request, reply, 'github-sync events', {
        keepaliveMs: null,
      });
      const onChange = () => stream.event('changed', {});

      let idleTicks = 0;
      const tick = setInterval(() => {
        if (stream.closed) return;
        if (hasActiveRun()) {
          idleTicks = 0;
          stream.event('changed', {});
        } else if (++idleTicks >= 30) {
          idleTicks = 0;
          stream.write(': keepalive\n\n');
        }
      }, 1_000);

      stream.onClose(() => {
        clearInterval(tick);
        githubSyncEvents.off('changed', onChange);
      });

      if (!stream.event('changed', {})) return;
      githubSyncEvents.on('changed', onChange);
    });

    fastify.post('/api/config/github-sync', cfgGuard, async (request, reply) => {
      const parsed = ConfigBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid' });
      }
      const runtimeError = validateRuntime(parsed.data);
      if (runtimeError) return reply.status(400).send({ error: runtimeError });

      const cfg = githubSyncConfigService.create(parsed.data);
      githubSyncCron.scheduleIfEnabled(cfg.id);
      return cfg;
    });

    fastify.patch<{ Params: { id: string } }>(
      '/api/config/github-sync/:id',
      cfgGuard,
      async (request, reply) => {
        const parsed = UpdateBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid' });
        }
        if (parsed.data.artifactPattern !== undefined) {
          try {
            new RegExp(parsed.data.artifactPattern);
          } catch (e) {
            return reply.status(400).send({
              error: `artifactPattern is not a valid regex: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }
        if (parsed.data.cronSchedule !== undefined) {
          const cronCheck = CronService.validateExpression(parsed.data.cronSchedule);
          if (!cronCheck.valid) {
            return reply.status(400).send({ error: `cronSchedule is invalid: ${cronCheck.error}` });
          }
        }
        if (
          parsed.data.startDate !== undefined &&
          Number.isNaN(Date.parse(parsed.data.startDate))
        ) {
          return reply.status(400).send({ error: 'startDate is not a valid date' });
        }

        const cfg = githubSyncConfigService.update(request.params.id, parsed.data);
        if (!cfg) return reply.status(404).send({ error: 'sync config not found' });
        githubSyncCron.scheduleIfEnabled(cfg.id);
        return cfg;
      }
    );

    fastify.patch<{ Params: { id: string } }>(
      '/api/config/github-sync/:id/enabled',
      cfgGuard,
      async (request, reply) => {
        const parsed = EnabledBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: 'enabled must be boolean' });
        }
        const ok = githubSyncConfigService.setEnabled(request.params.id, parsed.data.enabled);
        if (!ok) return reply.status(404).send({ error: 'sync config not found' });
        githubSyncCron.scheduleIfEnabled(request.params.id);
        return { id: request.params.id, enabled: parsed.data.enabled };
      }
    );

    fastify.delete<{ Params: { id: string }; Querystring: { clearState?: string } }>(
      '/api/config/github-sync/:id',
      cfgGuard,
      async (request, reply) => {
        const clearState = request.query.clearState === 'true';
        if (isRunning(request.params.id)) {
          stopSync(request.params.id);
        }
        githubSyncCron.unschedule(request.params.id);
        const ok = githubSyncConfigService.delete(request.params.id, { clearState });
        if (!ok) return reply.status(404).send({ error: 'sync config not found' });
        return { id: request.params.id, clearState };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/config/github-sync/:id/run',
      runGuard,
      async (request, reply) => {
        const cfg = githubSyncConfigService.getResolved(request.params.id);
        if (!cfg) return reply.status(404).send({ error: 'sync config not found' });
        if (isRunning(cfg.id)) {
          return reply.status(409).send({ error: 'sync already running' });
        }
        runSync(cfg, 'manual').catch((err) => {
          console.error(`[github-sync] manual run for ${cfg.name} crashed:`, err);
        });
        return { status: 'started', id: cfg.id };
      }
    );

    fastify.post<{ Params: { id: string } }>(
      '/api/config/github-sync/:id/stop',
      runGuard,
      async (request, reply) => {
        const cfg = githubSyncConfigService.get(request.params.id);
        if (!cfg) return reply.status(404).send({ error: 'sync config not found' });
        const stopped = stopSync(cfg.id);
        return { id: cfg.id, stopped };
      }
    );
  });
}
