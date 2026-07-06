import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface SseStream {
  write: (line: string) => boolean;
  event: (name: string, data: unknown) => boolean;
  close: () => void;
  readonly closed: boolean;
  onClose: (cb: () => void) => void;
}

// Opens a Server-Sent Events stream: writes the SSE head, wires request
// close/error to teardown, and (unless `keepaliveMs` is null) emits a comment
// heartbeat. Route-specific subscriptions register their own teardown via
// `onClose`; a failed write closes the stream and returns false so callers bail.
export function openSseStream(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  label: string,
  options: { keepaliveMs?: number | null } = {}
): SseStream {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  const teardown: Array<() => void> = [];

  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const fn of teardown) fn();
    try {
      reply.raw.end();
    } catch {
      // socket already destroyed
    }
  };

  const write = (line: string): boolean => {
    if (closed) return false;
    try {
      reply.raw.write(line);
      return true;
    } catch (err) {
      fastify.log.warn({ err }, `SSE write failed; closing ${label} stream`);
      close();
      return false;
    }
  };

  const keepaliveMs = options.keepaliveMs === undefined ? 30_000 : options.keepaliveMs;
  if (keepaliveMs !== null) {
    const keepalive = setInterval(() => write(': keepalive\n\n'), keepaliveMs);
    teardown.push(() => clearInterval(keepalive));
  }

  request.raw.on('close', close);
  request.raw.on('error', close);

  return {
    write,
    event: (name, data) => write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
    close,
    get closed() {
      return closed;
    },
    onClose: (cb) => {
      teardown.push(cb);
    },
  };
}
