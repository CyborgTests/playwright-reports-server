import type {
  LlmDefaultPrompt,
  LlmDefaultPrompts,
  LlmTask,
  LlmTaskStats,
  LlmUsageByModel,
  LlmUsageByModelRow,
  LlmUsageStats,
} from '@playwright-reports/shared';
import { keepPreviousData } from '@tanstack/react-query';

import useQuery from './useQuery';

export type {
  LlmTask,
  LlmTaskStats,
  LlmDefaultPrompt,
  LlmDefaultPrompts,
  LlmUsageByModel,
  LlmUsageByModelRow,
  LlmUsageStats,
};

export function useLlmTaskStats() {
  return useQuery<{ success: boolean } & LlmTaskStats>('/api/llm/tasks/stats', {
    staleTime: 5000,
    refetchInterval: 10_000,
  });
}

export function useLlmDefaultPrompts(options: { enabled?: boolean } = {}) {
  return useQuery<{ success: boolean; data: LlmDefaultPrompts }>('/api/llm/default-prompts', {
    // Defaults change only when the codebase changes — long stale time.
    staleTime: 60 * 60 * 1000,
    enabled: options.enabled,
  });
}

export function useLlmUsageStats(days: number) {
  return useQuery<{ success: boolean; data: LlmUsageStats }>(`/api/llm/usage-stats?days=${days}`, {
    dependencies: [days],
    staleTime: 30_000,
  });
}

export function useLlmUsageByModel(days: number, enabled: boolean) {
  return useQuery<{ success: boolean; data: LlmUsageByModel }>(
    `/api/llm/usage-by-model?days=${days}`,
    {
      dependencies: [days, enabled],
      staleTime: 30_000,
      enabled,
    }
  );
}

export function useLlmTasks(
  filters: {
    status?: string;
    type?: string;
    reportId?: string;
    model?: string;
    limit?: number;
    offset?: number;
  },
  options: {
    active?: boolean;
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.type) params.append('type', filters.type);
  if (filters.reportId) params.append('reportId', filters.reportId);
  if (filters.model) params.append('model', filters.model);
  params.append('limit', (filters.limit ?? 25).toString());
  params.append('offset', (filters.offset ?? 0).toString());

  return useQuery<{ success: boolean; data: LlmTask[]; total: number }>(
    `/api/llm/tasks?${params.toString()}`,
    {
      dependencies: [
        filters.status,
        filters.type,
        filters.reportId,
        filters.model,
        filters.limit,
        filters.offset,
      ],
      staleTime: 5000,
      refetchInterval: options.active ? 5000 : false,
      placeholderData: keepPreviousData,
    }
  );
}

export function useLlmTaskModels(enabled: boolean) {
  return useQuery<{ success: boolean; models: string[] }>('/api/llm/tasks/models', {
    enabled,
    staleTime: 30_000,
  });
}
