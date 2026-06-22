import type { FastifyInstance } from 'fastify';
import { registerAnalyticsRoutes } from './analytics.js';
import { registerAuthRoutes } from './auth.js';
import { registerCliRoutes } from './cli.js';
import { registerConfigRoutes } from './config.js';
import { registerFailureClusterRoutes } from './failureClusters.js';
import { registerGithubSyncRoutes } from './githubSync.js';
import { registerLlmRoutes } from './llm.js';
import { registerLlmFeedbackRoutes } from './llmFeedback.js';
import { registerLlmGroupsRoutes } from './llmGroups.js';
import { registerLlmModelsRoutes } from './llmModels.js';
import { registerNotificationsRoutes } from './notifications.js';
import { registerQualityRoutes } from './quality.js';
import { registerReportRoutes } from './reports.js';
import { registerResultRoutes } from './results.js';
import { registerServeRoutes } from './serve.js';
import { registerTestsRoutes } from './tests.js';

export async function registerApiRoutes(fastify: FastifyInstance) {
  await registerAuthRoutes(fastify);
  await registerReportRoutes(fastify);
  await registerResultRoutes(fastify);
  await registerConfigRoutes(fastify);
  await registerGithubSyncRoutes(fastify);
  await registerServeRoutes(fastify);
  await registerAnalyticsRoutes(fastify);
  await registerTestsRoutes(fastify);
  await registerLlmRoutes(fastify);
  await registerLlmModelsRoutes(fastify);
  await registerLlmGroupsRoutes(fastify);
  await registerLlmFeedbackRoutes(fastify);
  await registerCliRoutes(fastify);
  await registerNotificationsRoutes(fastify);
  await registerQualityRoutes(fastify);
  await registerFailureClusterRoutes(fastify);
}
