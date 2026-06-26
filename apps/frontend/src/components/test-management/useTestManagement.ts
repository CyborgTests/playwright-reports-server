import type { DateRange, TestFilters, TestWithQuarantineInfo } from '@playwright-reports/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { authHeadersForSession, useAuth } from '@/hooks/useAuth';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import useMutation from '@/hooks/useMutation';
import { defaultProjectName } from '@/lib/constants';
import { invalidateCache } from '@/lib/query-cache';
import { withBase } from '@/lib/url';

const PAGE_SIZE = 25;

type TestsPage = { data: TestWithQuarantineInfo[]; total: number };

export function useTestsQuery({
  filters,
  dateRange,
}: {
  filters: TestFilters;
  dateRange?: DateRange;
}) {
  const session = useAuth();
  const debouncedSearch = useDebouncedValue(filters.search, 300);

  const buildQueryParams = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (filters.project && filters.project !== defaultProjectName) {
        params.append('project', filters.project);
      }
      if (filters.status && filters.status !== 'all') {
        params.append('status', filters.status);
      }
      if (filters.tiers && filters.tiers.length > 0) {
        params.append('tiers', filters.tiers.join(','));
      }
      if (filters.sort && filters.sort !== 'default') {
        params.append('sort', filters.sort);
      }
      if (filters.failureCategory) {
        params.append('failureCategory', filters.failureCategory);
      }
      if (debouncedSearch) {
        params.append('search', debouncedSearch);
      }
      if (filters.regressedOnly) {
        params.append('regressedOnly', 'true');
      }
      if (filters.regressedSince) {
        params.append('regressedSince', filters.regressedSince);
      }
      if (filters.resolvedSince) {
        params.append('resolvedSince', filters.resolvedSince);
      }
      if (dateRange?.from) params.append('from', dateRange.from);
      if (dateRange?.to) params.append('to', dateRange.to);
      params.append('limit', PAGE_SIZE.toString());
      params.append('offset', offset.toString());
      return params.toString();
    },
    [filters, debouncedSearch, dateRange?.from, dateRange?.to]
  );

  const isAuthReady = session.status === 'authenticated';

  const query = useInfiniteQuery<TestsPage>({
    queryKey: [
      '/api/tests',
      { ...filters, search: debouncedSearch },
      dateRange?.from,
      dateRange?.to,
    ],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(withBase(`/api/tests?${buildQueryParams(pageParam as number)}`), {
        credentials: 'include',
        headers: authHeadersForSession(session),
      });
      if (!res.ok) throw new Error('Failed to fetch tests');
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.data.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: isAuthReady,
  });

  const tests = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const totalTests = query.data?.pages[0]?.total ?? 0;

  return {
    tests,
    totalTests,
    isLoadingTests: query.isLoading,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

export function useTestMutations({
  onQuarantineSuccess,
  onDeleteSuccess,
}: {
  onQuarantineSuccess: () => void;
  onDeleteSuccess: () => void;
}) {
  const queryClient = useQueryClient();

  const { mutate: updateQuarantineMutation, isPending: isUpdateQuarantinePending } = useMutation(
    '/api/test',
    {
      method: 'PATCH',
      onSuccess: (_, variables) => {
        invalidateCache(queryClient, { predicate: '/api/tests' });
        onQuarantineSuccess();
        const test = (variables as { body: { test: TestWithQuarantineInfo } }).body.test;
        toast.success(
          test.isQuarantined ? 'Test removed from quarantine' : 'Test quarantined successfully'
        );
      },
    }
  );

  const { mutate: deleteTestMutation, isPending: isDeletePending } = useMutation('/api/test', {
    method: 'DELETE',
    onSuccess: () => {
      invalidateCache(queryClient, { predicate: '/api/tests' });
      onDeleteSuccess();
      toast.success('Test deleted successfully');
    },
  });

  const { mutate: resetFlakinessMutation, isPending: isResetFlakinessPending } = useMutation(
    '/api/test',
    {
      method: 'POST',
      onSuccess: () => {
        invalidateCache(queryClient, { predicate: '/api/tests' });
        toast.success('Flakiness score reset - new flakiness will be tracked from now');
      },
    }
  );

  const { mutate: clearFlakinessResetMutation, isPending: isClearFlakinessResetPending } =
    useMutation('/api/test', {
      method: 'DELETE',
      onSuccess: () => {
        invalidateCache(queryClient, { predicate: '/api/tests' });
        toast.success('Flakiness reset removed - score recomputed over full window');
      },
    });

  return {
    updateQuarantineMutation,
    isUpdateQuarantinePending,
    deleteTestMutation,
    isDeletePending,
    resetFlakinessMutation,
    isResetFlakinessPending,
    clearFlakinessResetMutation,
    isClearFlakinessResetPending,
  };
}
