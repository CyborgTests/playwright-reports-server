export const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
