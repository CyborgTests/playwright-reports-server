import type { AnalyticsData, DateRange } from '@playwright-reports/shared';
import { withQueryParams } from '../lib/network';
import useQuery from './useQuery';

export function useAnalyticsData(project?: string, dateRange?: DateRange) {
  const baseUrl = '/api/analytics';
  const params: Record<string, string> = {};
  if (project) params.project = project;
  if (dateRange?.from) params.from = dateRange.from;
  if (dateRange?.to) params.to = dateRange.to;
  const url = withQueryParams(baseUrl, params) ?? baseUrl;

  return useQuery<AnalyticsData>(url, {
    dependencies: [project, dateRange?.from, dateRange?.to],
    staleTime: 5 * 60 * 1000,
    select: (response: unknown) => {
      if (
        response &&
        typeof response === 'object' &&
        'success' in response &&
        response.success === true
      ) {
        return (response as { success: true; data: AnalyticsData }).data;
      }
      return response as AnalyticsData;
    },
  });
}
