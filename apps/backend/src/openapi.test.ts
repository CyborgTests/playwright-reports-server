import assert from 'node:assert/strict';
import { test } from 'node:test';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import { SESSION_COOKIE } from './lib/auth/resolve.js';
import { formatTestsQueryValidationError, registerTestsRoutes } from './routes/tests.js';
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
    assert.deepEqual(Object.keys(operation.responses).sort(), ['200', '400', '401', '403', '500']);

    const successSchema = operation.responses['200'].content['application/json'].schema;
    assert.deepEqual(Object.keys(successSchema.properties).sort(), [
      'data',
      'reportRefs',
      'success',
      'total',
    ]);
    assert.deepEqual(successSchema.required, ['success', 'data', 'total', 'reportRefs']);
    assert.deepEqual(Object.keys(successSchema.properties.data.items.properties).sort(), [
      'annotations',
      'createdAt',
      'emaDuration',
      'fileId',
      'filePath',
      'flakinessResetAt',
      'flakinessScore',
      'history',
      'historyPassRate',
      'isQuarantined',
      'lastRunAt',
      'project',
      'quarantineReason',
      'quarantinedAt',
      'regression',
      'regressionHighlights',
      'tags',
      'testId',
      'title',
      'totalRuns',
    ]);
    assert.equal(spec.paths['/api/auth/signin'], undefined);
  } finally {
    await fastify.close();
  }
});

test('Fastify query validation errors keep the tests API error response shape', () => {
  const validationError = Object.assign(new Error('querystring validation failed'), {
    validation: [
      { instancePath: '/limit', message: 'must be integer' },
      { instancePath: '/status', message: 'must be equal to one of the allowed values' },
    ],
    validationContext: 'querystring',
  });

  assert.deepEqual(formatTestsQueryValidationError(validationError), {
    success: false,
    error: 'Invalid query parameters',
    issues: [
      { field: 'limit', message: 'must be integer' },
      { field: 'status', message: 'must be equal to one of the allowed values' },
    ],
  });
});
