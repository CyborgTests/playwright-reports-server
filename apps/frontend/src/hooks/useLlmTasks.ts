import type { LlmTask, LlmTaskStats } from '@playwright-reports/shared';

import useQuery from './useQuery';

export type { LlmTask, LlmTaskStats };

export function useLlmTaskStats() {
  return useQuery<{ success: boolean } & LlmTaskStats>('/api/llm/tasks/stats', {
    staleTime: 5000,
  });
}

export interface LlmUsageStats {
  days: number;
  fromDate: string;
  totals: {
    tasks: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  byType: Record<
    string,
    {
      type: string;
      tasks: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }
  >;
  reuse: {
    analyses: number;
    reused: number;
    rate: number;
  };
}

export interface LlmDefaultPrompt {
  /** Default template for this slot. Contains {{var}} placeholders; rendered
   *  through the same applyMustache path as user overrides, so the default
   *  shown in the UI doubles as a canonical usage example. */
  content: string;
  vars: string[];
}

export interface LlmDefaultPrompts {
  systemPrompt: LlmDefaultPrompt;
  testAnalysisSystemPrompt: LlmDefaultPrompt;
  projectSummarySystemPrompt: LlmDefaultPrompt;
  testAnalysisInstructions: LlmDefaultPrompt;
  /** Combined override slot for report-summary (replaces the two-field
   *  system+instructions surface in earlier versions). */
  reportSummaryPrompt: LlmDefaultPrompt;
  projectSummaryInstructions: LlmDefaultPrompt;
}

export function useLlmDefaultPrompts() {
  return useQuery<{ success: boolean; data: LlmDefaultPrompts }>('/api/llm/default-prompts', {
    // Defaults change only when the codebase changes — long stale time.
    staleTime: 60 * 60 * 1000,
  });
}

export function useLlmUsageStats(days: number) {
  return useQuery<{ success: boolean; data: LlmUsageStats }>(`/api/llm/usage-stats?days=${days}`, {
    dependencies: [days],
    staleTime: 30_000,
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
