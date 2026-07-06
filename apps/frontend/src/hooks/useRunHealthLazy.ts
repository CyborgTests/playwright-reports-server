import type { DateRange, RunHealthMetric } from '@playwright-reports/shared';
import { useCallback } from 'react';
import { authHeaders } from '../lib/auth';
import { withBase } from '../lib/url';
import { useLazyPrevious } from './useLazyPrevious';

const PAGE_SIZE = 100;

interface RunHealthPageResponse {
  metrics: RunHealthMetric[];
  hasMore: boolean;
}

const getKey = (m: RunHealthMetric) => m.runId;
const getCursor = (m: RunHealthMetric) => new Date(m.timestamp).toISOString();

export function useRunHealthLazy(
  project: string | undefined,
  dateRange: DateRange | undefined,
  failedOnly: boolean,
  initialMetrics: RunHealthMetric[],
  totalRuns: number
) {
  const from = dateRange?.from;
  const to = dateRange?.to;

  const fetchPage = useCallback(
    async (before: string) => {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (failedOnly) params.set('failedOnly', 'true');
      params.set('before', before);
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(withBase(`/api/analytics/run-health?${params.toString()}`), {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load previous runs (${res.status})`);
      const body = (await res.json()) as { success: boolean; data: RunHealthPageResponse };
      return { items: body.data.metrics, hasMore: body.data.hasMore };
    },
    [project, from, to, failedOnly]
  );

  const scopeKey = `${project ?? ''}|${from ?? ''}|${to ?? ''}|${failedOnly ? 1 : 0}`;
  const { items, loadPrevious, hasMore, isLoadingPrevious } = useLazyPrevious<RunHealthMetric>({
    initial: initialMetrics,
    total: totalRuns,
    scopeKey,
    getKey,
    getCursor,
    fetchPage,
  });

  return { metrics: items, loadPrevious, hasMore, isLoadingPrevious, scopeKey };
}
