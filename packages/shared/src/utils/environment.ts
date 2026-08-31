/** Values treated as missing environment when normalizing stored metadata. */
export const UNKNOWN_ENV_VALUES = new Set([
  '',
  'unknown',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
]);

/** Query param / filter sentinel for reports with no normalized environment (IS NULL). */
export const ENV_UNKNOWN_FILTER = 'unknown';

export const DEFAULT_ENVIRONMENT_FILTER = 'all';

/**
 * Normalize deployment environment from upload metadata.
 * Returns null when the value is missing or semantically empty.
 */
export function normalizeEnvironment(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (!value || UNKNOWN_ENV_VALUES.has(value.toLowerCase())) return null;
  return value;
}

export function isEnvironmentUnknownFilter(value: string | undefined): boolean {
  return value === ENV_UNKNOWN_FILTER;
}

export function isEnvironmentFilterActive(value: string | undefined): boolean {
  return !!value && value !== DEFAULT_ENVIRONMENT_FILTER;
}
