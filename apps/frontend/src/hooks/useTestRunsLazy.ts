import type { TestRun } from '@playwright-reports/shared';
import { useCallback } from 'react';
import { authHeaders } from '../lib/auth';
import { withBase } from '../lib/url';
import { useLazyPrevious } from './useLazyPrevious';

const PAGE_SIZE = 100;

interface TestRunsPageResponse {
  runs: TestRun[];
  hasMore: boolean;
}

const getKey = (r: TestRun) => r.runId;
const getCursor = (r: TestRun) => r.createdAt;

export function useTestRunsLazy(
  testId: string,
  project: string,
  initialRuns: TestRun[],
  totalRuns: number
) {
  const fetchPage = useCallback(
    async (before: string) => {
      const params = new URLSearchParams();
      params.set('project', project);
      params.set('before', before);
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(
        withBase(`/api/test/${encodeURIComponent(testId)}/runs?${params.toString()}`),
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`Failed to load previous runs (${res.status})`);
      const body = (await res.json()) as { success: boolean; data: TestRunsPageResponse };
      return { items: body.data.runs, hasMore: body.data.hasMore };
    },
    [testId, project]
  );

  const { items, loadPrevious, hasMore, isLoadingPrevious } = useLazyPrevious<TestRun>({
    initial: initialRuns,
    total: totalRuns,
    scopeKey: `${testId}|${project}`,
    getKey,
    getCursor,
    fetchPage,
  });

  return { runs: items, loadPrevious, hasMore, isLoadingPrevious };
}
