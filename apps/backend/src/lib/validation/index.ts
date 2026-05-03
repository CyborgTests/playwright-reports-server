import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateSchema<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessages = result.error.issues.map((err: any) => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    throw new ValidationError('Validation failed', errorMessages);
  }
  return result.data;
}

export function validateQuery<T extends z.ZodType>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      request.query = validateSchema(schema, request.query);
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: error.details,
        });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  };
}

export function validateBody<T extends z.ZodType>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      request.body = validateSchema(schema, request.body);
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: error.details,
        });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  };
}

export function validateParams<T extends z.ZodType>(schema: T) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      request.params = validateSchema(schema, request.params);
    } catch (error) {
      if (error instanceof ValidationError) {
        return reply.status(400).send({
          error: 'Invalid URL parameters',
          details: error.details,
        });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  };
}

export function createJsonSchema(zodSchema: z.ZodType) {
  return zodTypeToJsonSchema(zodSchema);
}

function zodTypeToJsonSchema(_zodType: any): any {
  return { type: 'any' };
}
