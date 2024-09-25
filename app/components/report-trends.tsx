'use client';

import { Spinner } from '@nextui-org/react';

import { TrendChart } from '@/app/components/trend-chart';
import { title } from '@/app/components/primitives';
import useQuery from '@/app/hooks/useQuery';
import ErrorMessage from '@/app/components/error-message';
import { type ReportHistory } from '@/app/lib/data';

export default function ReportTrends() {
  const { data: reports, error, isLoading } = useQuery<ReportHistory[]>('/api/report/trend');

  return (
    <>
      <div>
        <h1 className={title()}>Trends</h1>
      </div>
      {error && <ErrorMessage message={error.message} />}
      {isLoading && <Spinner />}
      {!!reports?.length && <TrendChart reports={reports} />}
    </>
  );
}
