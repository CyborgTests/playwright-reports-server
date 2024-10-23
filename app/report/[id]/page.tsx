'use client';

import { Spinner, Button } from '@nextui-org/react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

import ReportStatistics from '@/app/components/report-details/report-stats';
import FileList from '@/app/components/report-details/file-list';
import useQuery from '@/app/hooks/useQuery';
import { type ReportHistory } from '@/app/lib/storage';
import { subtitle, title } from '@/app/components/primitives';
import FormattedDate from '@/app/components/date-format';

interface ReportDetailProps {
  params: { id: string };
}

function ReportDetail({ params }: Readonly<ReportDetailProps>) {
  const session = useSession();

  const {
    data: report,
    isLoading: isReportLoading,
    error: reportError,
  } = useQuery<ReportHistory>(`/api/report/${params.id}`, { callback: `/report/${params.id}` });

  if (session.status === 'loading') {
    return (
      <div>
        Loading auth... <Spinner />
      </div>
    );
  }

  if (!report && isReportLoading) {
    return (
      <div>
        Loading report... <Spinner />
      </div>
    );
  }

  reportError && toast.error(reportError.message);

  return (
    <>
      <div className="text-center">
        <h1 className={title()}>Report</h1>
        {report?.createdAt && (
          <span className={subtitle()}>
            <FormattedDate date={report.createdAt} />
          </span>
        )}
      </div>
      <div className="flex md:flex-row flex-col gap-2">
        <div className="flex flex-col items-center md:w-1/4 max-w-full">
          <ReportStatistics stats={report?.stats} />
          <Link href={report?.reportUrl ?? ''} target="_blank">
            <Button color="primary">Open report</Button>
          </Link>
        </div>
        <div className="md:w-3/4 max-w-full">{report && <FileList report={report} />}</div>
      </div>
    </>
  );
}

export default ReportDetail;
