import type { FailureCategoryAnalytics } from '@playwright-reports/shared';
import { withQueryParams } from '../lib/network';
import useQuery from './useQuery';

export function useFailureCategories(
  project?: string,
  dateRange?: { from?: string; to?: string },
  enabled = true
) {
  const baseUrl = '/api/analytics/failure-categories';
  const params: Record<string, string> = {};
  if (project) params.project = project;
  if (dateRange?.from) params.from = dateRange.from;
  if (dateRange?.to) params.to = dateRange.to;
  const url = withQueryParams(baseUrl, params) ?? baseUrl;

  return useQuery<FailureCategoryAnalytics>(url, {
    enabled,
    dependencies: [project, dateRange?.from, dateRange?.to, enabled],
    staleTime: 60 * 1000,
    select: (response: unknown) => {
      if (
        response &&
        typeof response === 'object' &&
        'success' in response &&
        response.success === true
      ) {
        return (response as { success: true; data: FailureCategoryAnalytics }).data;
      }
      return response as FailureCategoryAnalytics;
    },
  });
}
