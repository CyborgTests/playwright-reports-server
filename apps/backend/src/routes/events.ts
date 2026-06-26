import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openSseStream } from '../lib/sse.js';
import { type DataEntityKind, dataEvents } from '../lib/service/dataEvents.js';
import { authorize } from './auth.js';

export async function registerEventsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authorize(CAPABILITIES.view)(request, reply);
    if (authResult || reply.sent) return;

    const stream = openSseStream(fastify, request, reply, 'events');

    let flush: NodeJS.Timeout | undefined;
    const pending = new Set<DataEntityKind>();

    const sendPending = () => {
      flush = undefined;
      if (stream.closed || pending.size === 0) return;
      const kinds = [...pending];
      pending.clear();
      stream.event('changed', { kinds });
    };

    const onChange = (kind: DataEntityKind) => {
      if (stream.closed) return;
      pending.add(kind);
      if (!flush) flush = setTimeout(sendPending, 750);
    };

    stream.onClose(() => {
      if (flush) clearTimeout(flush);
      dataEvents.off('changed', onChange);
    });

    if (!stream.event('changed', { kinds: ['report', 'result'] })) return;
    dataEvents.on('changed', onChange);
  });
}
