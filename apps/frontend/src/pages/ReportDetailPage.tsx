import type { ReportHistory } from '@playwright-reports/shared';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import FormattedDate from '@/components/date-format';
import { subtitle, title } from '@/components/primitives';
import FileList from '@/components/report-details/file-list';
import ReportFailureSummary from '@/components/report-details/ReportFailureSummary';
import ReportStatistics from '@/components/report-details/report-stats';
import { CompareToPicker } from '@/components/reports-compare/compare-to-picker';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/hooks/useAuth';
import useQuery from '@/hooks/useQuery';
import { withBase } from '@/lib/url';

function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const auth = useAuth();
  const isAuthLoading = auth.status === 'loading';

  const highlightTestId = location.state?.highlightTestId;

  const {
    data: report,
    isLoading: isReportLoading,
    error: reportError,
  } = useQuery<ReportHistory>(`/api/report/${id}`, {
    callback: `/report/${id}`,
  });

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center w-full">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!report && isReportLoading) {
    return (
      <div className="flex items-center justify-center w-full">
        <Spinner size="lg" />
      </div>
    );
  }

  reportError && toast.error(reportError.message);

  return (
    <>
      <h1 className={title()}>
        {report?.displayNumber ? `#${report.displayNumber} ` : ''} {report?.title ?? ''}
      </h1>
      {report?.createdAt && (
        <span className={`${subtitle()} mt-4 mb-6 text-right`}>
          <span className="text-sm">
            <FormattedDate date={report.createdAt} />
          </span>
        </span>
      )}
      {id && <ReportFailureSummary reportId={id} />}
      <div className="flex md:flex-row flex-col gap-2">
        <div className="flex flex-col items-center md:w-1/4 max-w-full gap-2">
          <ReportStatistics stats={report?.stats} />
          <Link to={withBase(report?.reportUrl ?? '')} target="_blank">
            <Button>Open report</Button>
          </Link>
          {id && (
            <CompareToPicker
              excludeReportIds={[id]}
              defaultProject={report?.project}
              // From the report detail page: baseline = picked (older), target = current.
              buildHref={(otherId) => withBase(`/reports/compare?a=${otherId}&b=${id}`)}
            />
          )}
        </div>
        <div className="md:w-3/4 max-w-full">
          {report && <FileList report={report} highlightTestId={highlightTestId} />}
        </div>
      </div>
    </>
  );
}

export default ReportDetailPage;
