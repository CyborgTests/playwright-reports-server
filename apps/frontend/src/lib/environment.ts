import {
  DEFAULT_ENVIRONMENT_FILTER,
  ENV_UNKNOWN_FILTER,
  normalizeEnvironment,
} from '@playwright-reports/shared';

export { DEFAULT_ENVIRONMENT_FILTER, ENV_UNKNOWN_FILTER };

export function getEnvironmentLabel(raw: unknown): string | null {
  return normalizeEnvironment(raw);
}

export function environmentFilterQueryValue(environment: string): string | undefined {
  return environment !== DEFAULT_ENVIRONMENT_FILTER ? environment : undefined;
}

export function environmentOptionLabel(value: string): string {
  if (value === DEFAULT_ENVIRONMENT_FILTER) return 'All environments';
  if (value === ENV_UNKNOWN_FILTER) return 'Unknown';
  return value;
}
