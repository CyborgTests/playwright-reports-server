import type { LlmTask, LlmTaskStats } from '@playwright-reports/shared';

import useQuery from './useQuery';

export type { LlmTask, LlmTaskStats };

export function useLlmTaskStats() {
  return useQuery<{ success: boolean } & LlmTaskStats>('/api/llm/tasks/stats', {
    staleTime: 5000,
  });
}

export function useLlmTasks(filters: {
  status?: string;
  type?: string;
  reportId?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.type) params.append('type', filters.type);
  if (filters.reportId) params.append('reportId', filters.reportId);
  params.append('limit', (filters.limit ?? 25).toString());
  params.append('offset', (filters.offset ?? 0).toString());

  return useQuery<{ success: boolean; data: LlmTask[]; total: number }>(
    `/api/llm/tasks?${params.toString()}`,
    {
      dependencies: [filters.status, filters.type, filters.reportId, filters.limit, filters.offset],
      staleTime: 5000,
    }
  );
}
