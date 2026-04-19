import type { FastifyInstance } from 'fastify';
import { registerAnalyticsRoutes } from './analytics.js';
import { registerAuthRoutes } from './auth.js';
import { registerConfigRoutes } from './config.js';
import { registerLlmRoutes } from './llm.js';
import { registerReportRoutes } from './reports.js';
import { registerResultRoutes } from './results.js';
import { registerServeRoutes } from './serve.js';
import { registerTestsRoutes } from './tests.js';

export async function registerApiRoutes(fastify: FastifyInstance) {
  await registerAuthRoutes(fastify);
  await registerReportRoutes(fastify);
  await registerResultRoutes(fastify);
  await registerConfigRoutes(fastify);
  await registerServeRoutes(fastify);
  await registerAnalyticsRoutes(fastify);
  await registerTestsRoutes(fastify);
  await registerLlmRoutes(fastify);
}
