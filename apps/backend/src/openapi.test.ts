import assert from 'node:assert/strict';
import { test } from 'node:test';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import { SESSION_COOKIE } from './lib/auth/resolve.js';
import { registerTestsRoutes } from './routes/tests.js';
import { APP_VERSION } from './version.js';

test('OpenAPI serves the tagged tests endpoint with query and auth metadata', async () => {
  const fastify = Fastify({ logger: false });

  try {
    await fastify.register(fastifySwagger, {
      openapi: {
        info: { title: 'Playwright Reports Server API', version: APP_VERSION },
        components: {
          securitySchemes: {
            sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
            bearerAuth: { type: 'http', scheme: 'bearer' },
          },
        },
      },
      hideUntagged: true,
    });
    await fastify.register(fastifySwaggerUi, { routePrefix: '/documentation' });
    await registerTestsRoutes(fastify);

    const response = await fastify.inject('/documentation/json');
    assert.equal(response.statusCode, 200);

    const spec = response.json();
    const operation = spec.paths['/api/tests'].get;
    assert.deepEqual(
      operation.parameters.map((parameter: { name: string }) => parameter.name).sort(),
      [
        'failureCategory',
        'from',
        'limit',
        'offset',
        'project',
        'regressedOnly',
        'regressedSince',
        'resolvedSince',
        'search',
        'slim',
        'sort',
        'status',
        'tiers',
        'to',
      ]
    );
    assert.deepEqual(operation.security, [{ sessionCookie: [] }, { bearerAuth: [] }]);
    assert.equal(spec.paths['/api/auth/signin'], undefined);
  } finally {
    await fastify.close();
  }
});
