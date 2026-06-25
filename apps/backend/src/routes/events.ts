import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type DataEntityKind, dataEvents } from '../lib/service/dataEvents.js';
import { authorize } from './auth.js';

export async function registerEventsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const authResult = await authorize(CAPABILITIES.view)(request, reply);
    if (authResult || reply.sent) return;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    let keepalive: NodeJS.Timeout | undefined;
    let flush: NodeJS.Timeout | undefined;
    const pending = new Set<DataEntityKind>();

    const write = (line: string): boolean => {
      if (closed) return false;
      try {
        reply.raw.write(line);
        return true;
      } catch (err) {
        fastify.log.warn({ err }, 'SSE write failed; closing events stream');
        cleanup();
        try {
          reply.raw.end();
        } catch {
          // socket already destroyed
        }
        return false;
      }
    };

    const sendPending = () => {
      flush = undefined;
      if (closed || pending.size === 0) return;
      const kinds = [...pending];
      pending.clear();
      write(`event: changed\ndata: ${JSON.stringify({ kinds })}\n\n`);
    };

    const onChange = (kind: DataEntityKind) => {
      if (closed) return;
      pending.add(kind);
      if (!flush) flush = setTimeout(sendPending, 750);
    };

    function cleanup() {
      if (closed) return;
      closed = true;
      if (keepalive) clearInterval(keepalive);
      if (flush) clearTimeout(flush);
      dataEvents.off('changed', onChange);
    }

    if (!write(`event: changed\ndata: ${JSON.stringify({ kinds: ['report', 'result'] })}\n\n`)) {
      return;
    }

    keepalive = setInterval(() => {
      if (closed) return;
      try {
        reply.raw.write(': keepalive\n\n');
      } catch {
        cleanup();
      }
    }, 30_000);

    dataEvents.on('changed', onChange);
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
