import type { z } from 'zod';

export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function zodErrorResponse(error: z.ZodError): {
  success: false;
  error: string;
  issues: Array<{ field: string; message: string }>;
} {
  const issues = error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  return {
    success: false,
    error: issues.map((i) => (i.field ? `${i.field}: ${i.message}` : i.message)).join('; '),
    issues,
  };
}

export function validateSchema<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessages = result.error.issues.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    throw new ValidationError('Validation failed', errorMessages);
  }
  return result.data;
}
