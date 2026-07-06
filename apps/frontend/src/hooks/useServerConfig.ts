import type { ServerConfig } from '@playwright-reports/shared';

import useQuery from './useQuery';

export const SERVER_CONFIG_KEY = '/api/config';

export function useServerConfig() {
  return useQuery<ServerConfig>(SERVER_CONFIG_KEY, { staleTime: 10_000 });
}
