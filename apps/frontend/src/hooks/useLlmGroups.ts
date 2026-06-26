import type { LlmConcurrencyGroup } from '@playwright-reports/shared';

import useQuery from './useQuery';

export const LLM_GROUPS_PATH = '/api/config/llm-groups';

export function useLlmGroups() {
  return useQuery<LlmConcurrencyGroup[]>(LLM_GROUPS_PATH, { staleTime: 10_000 });
}
