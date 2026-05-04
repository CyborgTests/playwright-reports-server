import type { DateRange, FailureCategoryAnalytics } from '@playwright-reports/shared';
import { defaultProjectName } from '../lib/constants';
import useQuery from './useQuery';

export function useFailureCategoryData(project?: string, dateRange?: DateRange) {
  const params = new URLSearchParams();
  if (project && project !== defaultProjectName) {
    params.append('project', project);
  }
  if (dateRange?.from) params.append('from', dateRange.from);
  if (dateRange?.to) params.append('to', dateRange.to);

  return useQuery<{ success: boolean; data: FailureCategoryAnalytics }>(
    `/api/analytics/failure-categories?${params.toString()}`,
    {
      dependencies: [project, dateRange?.from, dateRange?.to],
      staleTime: 5 * 60 * 1000,
    }
  );
}
