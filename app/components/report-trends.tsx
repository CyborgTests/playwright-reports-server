'use client';

import { Spinner } from "@heroui/react";
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { defaultProjectName } from '../lib/constants';

import ProjectSelect from './project-select';

import { TrendChart } from '@/app/components/trend-chart';
import { title } from '@/app/components/primitives';
import useQuery from '@/app/hooks/useQuery';
import { type ReportHistory } from '@/app/lib/storage';
import { withQueryParams } from '@/app/lib/network';

export default function ReportTrends() {
  const [project, setProject] = useState(defaultProjectName);

  const {
    data: reports,
    error,
    isFetching,
    isPending,
  } = useQuery<ReportHistory[]>(
    withQueryParams('/api/report/trend', {
      project,
    }),
    { dependencies: [project] },
  );

  const onProjectChange = useCallback((project: string) => {
    setProject(project);
  }, []);

  error && toast.error(error.message);

  return (
    <>
      <div className="flex flex-row justify-between">
        <h1 className={title()}>Trends</h1>
        {(isFetching || isPending) && <Spinner />}
        <div className="min-w-[30%]">
          <ProjectSelect entity="report" onSelect={onProjectChange} />
        </div>
      </div>
      {!!reports?.length && <TrendChart reportHistory={reports} />}
    </>
  );
}
