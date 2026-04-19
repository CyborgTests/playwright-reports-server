import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { useQuery } from '@tanstack/react-query';
import { withBase } from '../lib/url';

export const CONFIG_QUERY_KEY = ['config'];

async function fetchConfig(): Promise<SiteWhiteLabelConfig> {
  const res = await fetch(withBase('/api/config'));
  if (!res.ok) {
    throw new Error('Failed to fetch config');
  }
  return res.json();
}

export function useConfig() {
  return useQuery<SiteWhiteLabelConfig>({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: fetchConfig,
  });
}

export { fetchConfig };
