'use client';

import { Spinner, Button } from '@nextui-org/react';
import Link from 'next/link';

import ReportStatistics from '@/app/components/report-details/report-stats';
import FileList from '@/app/components/report-details/file-list';
import useQuery from '@/app/hooks/useQuery';
import { type ReportInfo } from '@/app/lib/parser';
import { type ReportHistory } from '@/app/lib/data';
import { serveReportRoute } from '@/app/lib/constants';
import { title } from '@/app/components/primitives';
import { useApiToken } from '@/app/providers/ApiTokenProvider';
import { setReportAuthCookie } from '@/app/config/cookie';

interface ReportDetailProps {
  params: { id: string };
}

function ReportDetail({ params }: Readonly<ReportDetailProps>) {
  const {
    data: report,
    isLoading: isReportLoading,
    error: reportError,
  } = useQuery<ReportInfo>(`/api/report/${params.id}`);

  const {
    data: history,
    isLoading: isHistoryLoading,
    error: historyError,
  } = useQuery<ReportHistory[]>('/api/report/trend?limit=10');

  const { apiToken } = useApiToken();

  // ensure the report is authenticated when specific test history is opened
  // otherwise report index page will be loaded
  setReportAuthCookie(apiToken);

  if (!report && isReportLoading) {
    return (
      <div>
        Loading report... <Spinner />
      </div>
    );
  }

  if (isHistoryLoading) {
    return (
      <div>
        Loading test history... <Spinner />
      </div>
    );
  }

  const error = reportError || historyError;

  if (error) {
    return <p>Error: {error.message}</p>;
  }

  return (
    <>
      <div className="text-center">
        <h1 className={title()}>Report</h1>
      </div>
      <div className="flex md:flex-row flex-col gap-2">
        <div className="flex flex-col items-center md:w-1/4 max-w-full">
          <ReportStatistics stats={report?.stats} />
          <Link href={`${serveReportRoute}/${params.id}/index.html`} target="_blank">
            <Button as="a" color="primary">
              Open report
            </Button>
          </Link>
        </div>
        <div className="md:w-3/4 max-w-full">
          <FileList history={history ?? []} report={report} />
        </div>
      </div>
    </>
  );
}

export default ReportDetail;
