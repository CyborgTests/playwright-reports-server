import type {
  LlmDefaultPrompt,
  LlmDefaultPrompts,
  LlmEstimates,
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

const PENDING_REFETCH_MS = 10_000;

function refetchWhilePending(stats: LlmTaskStats | undefined): number | false {
  const pending = (stats?.queued ?? 0) + (stats?.processing ?? 0);
  return pending > 0 ? PENDING_REFETCH_MS : false;
}

export function useLlmTaskStats() {
  const query = useQuery<{ success: boolean } & LlmTaskStats>('/api/llm/tasks/stats', {
    staleTime: 5000,
    refetchInterval: (q) => refetchWhilePending(q.state.data),
  });
  return query;
}

export function useLlmDefaultPrompts(options: { enabled?: boolean } = {}) {
  return useQuery<{ success: boolean; data: LlmDefaultPrompts }>('/api/llm/default-prompts', {
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

export function useLlmUsageByModel(days: number) {
  return useQuery<{ success: boolean; data: LlmUsageByModel }>(
    `/api/llm/usage-by-model?days=${days}`,
    {
      dependencies: [days],
      staleTime: 30_000,
    }
  );
}

export function useLlmTasks(filters: {
  status?: string;
  type?: string;
  reportId?: string;
  model?: string;
  limit?: number;
  offset?: number;
}) {
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
      placeholderData: keepPreviousData,
      refetchInterval: (q) =>
        q.state.data?.data?.some((t) => t.status === 'queued' || t.status === 'processing')
          ? PENDING_REFETCH_MS
          : false,
    }
  );
}

export function useLlmEstimates() {
  return useQuery<{ success: boolean; data: LlmEstimates }>('/api/llm/estimates', {
    staleTime: 30_000,
  });
}

export function useLlmTaskModels(enabled: boolean) {
  return useQuery<{ success: boolean; models: string[] }>('/api/llm/tasks/models', {
    enabled,
    staleTime: 30_000,
  });
}
