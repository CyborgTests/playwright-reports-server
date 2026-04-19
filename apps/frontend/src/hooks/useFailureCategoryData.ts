import type { FailureCategoryAnalytics } from '@playwright-reports/shared';
import useQuery from './useQuery';
import { defaultProjectName } from '../lib/constants';

export function useFailureCategoryData(project?: string) {
  const params = new URLSearchParams();
  if (project && project !== defaultProjectName) {
    params.append('project', project);
  }

  return useQuery<{ success: boolean; data: FailureCategoryAnalytics }>(
    `/api/analytics/failure-categories?${params.toString()}`,
    {
      dependencies: [project],
      staleTime: 5 * 60 * 1000,
    }
  );
}
