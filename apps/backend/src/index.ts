import { join, resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { llmAnalysisQueue } from './lib/service/llmAnalysisQueue.js';
import { lifecycle } from './lib/service/lifecycle.js';
import { registerApiRoutes } from './routes/index.js';

const logByEnv = {
  dev: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
  prod: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

async function start() {
  const fastify = Fastify({
    logger: logByEnv[env.isDev ? 'dev' : 'prod'],
    bodyLimit: 4294967294, // ~4GB, effectively unlimited
  });

  await fastify.register(fastifyCors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  });

  await fastify.register(fastifyCookie);

  await fastify.register(fastifyJwt, {
    secret: env.AUTH_SECRET ?? 'default-secret-for-no-auth-mode',
    cookie: {
      cookieName: 'token',
      signed: false,
    },
  });

  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 0, // 0 = unlimited
      files: 1,
    },
    attachFieldsToBody: false,
  });

  fastify.get('/api/ping', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/api/health', async () => {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  });

  await registerApiRoutes(fastify);

  const dataDir = resolve(process.env.DATA_DIR || join(process.cwd(), 'data'));
  await fastify.register(fastifyStatic, {
    root: dataDir,
    prefix: '/data/',
    decorateReply: false,
  });

  if (process.env.NODE_ENV === 'production') {
    const frontendDistPath = resolve(
      process.env.FRONTEND_DIST || join(process.cwd(), '..', '..', 'apps', 'frontend', 'dist')
    );

    await fastify.register(fastifyStatic, {
      root: frontendDistPath,
      decorateReply: true,
    });

    // spa fallback for non-api routes
    fastify.setNotFoundHandler(async (request, reply) => {
      if (!request.url.startsWith('/api') && !request.url.startsWith('/data')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  console.log('[server] Initializing databases and services...');
  await lifecycle.initialize();
  llmAnalysisQueue.start();
  console.log('[server] Initialization complete');

  const closeGracefully = async (signal: string) => {
    fastify.log.info(`Received signal to terminate: ${signal}`);
    llmAnalysisQueue.stop();
    await lifecycle.cleanup();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', () => closeGracefully('SIGINT'));
  process.on('SIGTERM', () => closeGracefully('SIGTERM'));

  try {
    await fastify.listen({ port: env.PORT, host: env.HOST });
    fastify.log.info(`Server listening on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

await start();
