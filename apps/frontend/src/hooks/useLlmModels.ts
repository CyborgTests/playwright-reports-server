import type { LlmModel } from '@playwright-reports/shared';

import useQuery from './useQuery';

export const LLM_MODELS_PATH = '/api/config/llm-models';

export function useLlmModels(options: { enabled?: boolean } = {}) {
  return useQuery<LlmModel[]>(LLM_MODELS_PATH, {
    staleTime: 10_000,
    ...(options.enabled !== undefined && { enabled: options.enabled }),
  });
}
