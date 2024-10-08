'use client';

import { Spinner } from '@nextui-org/react';
import { useState } from 'react';

import { defaultProjectName } from '../lib/constants';

import ProjectSelect from './project-select';

import { TrendChart } from '@/app/components/trend-chart';
import { title } from '@/app/components/primitives';
import useQuery from '@/app/hooks/useQuery';
import ErrorMessage from '@/app/components/error-message';
import { type ReportHistory } from '@/app/lib/storage';

export default function ReportTrends() {
  const { data: reports, error, isLoading } = useQuery<ReportHistory[]>('/api/report/trend');
  const [project, setProject] = useState(defaultProjectName);

  return (
    <>
      <div className="flex flex-row justify-between">
        <h1 className={title()}>Trends</h1>
        <ProjectSelect onSelect={setProject} />
      </div>
      {error && <ErrorMessage message={error.message} />}
      {isLoading && <Spinner />}
      {!!reports?.length && <TrendChart project={project} reportHistory={reports} />}
    </>
  );
}
