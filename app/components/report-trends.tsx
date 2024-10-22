'use client';

import { Spinner } from '@nextui-org/react';
import { useCallback } from 'react';

import { defaultProjectName } from '../lib/constants';

import ProjectSelect from './project-select';

import { TrendChart } from '@/app/components/trend-chart';
import { title } from '@/app/components/primitives';
import useQuery from '@/app/hooks/useQuery';
import ErrorMessage from '@/app/components/error-message';
import { type ReportHistory } from '@/app/lib/storage';

export default function ReportTrends() {
  const getProjectQueryParam = (project: string) =>
    project === defaultProjectName ? '' : `?project=${encodeURIComponent(project)}`;

  const getUrl = (project: string) => `/api/report/trend${getProjectQueryParam(project)}`;

  const { data: reports, error, isLoading, refetch } = useQuery<ReportHistory[]>(getUrl(defaultProjectName));

  const onProjectChange = useCallback((project: string) => {
    refetch({ path: getUrl(project) });
  }, []);

  return (
    <>
      <div className="flex flex-row justify-between">
        <h1 className={title()}>Trends</h1>
        {isLoading && <Spinner />}
        <div className="min-w-[30%]">
          <ProjectSelect entity="report" onSelect={onProjectChange} />
        </div>
      </div>
      {error && <ErrorMessage message={error.message} />}
      {!!reports?.length && <TrendChart reportHistory={reports} />}
    </>
  );
}
