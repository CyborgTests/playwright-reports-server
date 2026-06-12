import type { ReportHistory } from '@playwright-reports/shared';
import { AlertOctagon, GitCompare, Users } from 'lucide-react';
import { useEffect } from 'react';
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
import useQuery from '@/hooks/useQuery';
import { withBase } from '@/lib/url';

function RegressionHeaderChip({
  regressions,
}: Readonly<{ regressions?: { newHere: number; resolvedHere: number } }>) {
  if (!regressions) return null;
  const { newHere, resolvedHere } = regressions;
  if (newHere === 0 && resolvedHere === 0) return null;
  const parts: string[] = [];
  if (newHere > 0) parts.push(`${newHere} new`);
  if (resolvedHere > 0) parts.push(`${resolvedHere} resolved`);
  const accent = newHere > 0 ? 'danger' : 'success';
  const borderClass =
    accent === 'danger' ? 'border-danger/40 text-danger' : 'border-success/40 text-success';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${borderClass}`}
      title="Regressions new/resolved in this report"
    >
      <AlertOctagon className="h-3.5 w-3.5" />
      {parts.join(' · ')} regression{newHere + resolvedHere === 1 ? '' : 's'}
    </span>
  );
}

function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();

  const highlightTestId = location.state?.highlightTestId;

  const {
    data: report,
    isLoading: isReportLoading,
    error: reportError,
  } = useQuery<ReportHistory>(`/api/report/${id}`);

  useEffect(() => {
    if (reportError) toast.error(reportError.message);
  }, [reportError]);

  if (!report && isReportLoading) {
    return (
      <div className="flex items-center justify-center w-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={title()}>
          {report?.displayNumber ? `#${report.displayNumber} ` : ''} {report?.title ?? ''}
        </h1>
        {id &&
          (report?.previousReportId ? (
            <Link
              to={withBase(`/reports/compare?a=${report.previousReportId}&b=${id}`)}
              target="_blank"
            >
              <Button variant="outline" size="sm" className="gap-2">
                <GitCompare className="h-4 w-4" />
                Compare with previous
              </Button>
            </Link>
          ) : (
            <CompareToPicker
              excludeReportIds={[id]}
              defaultProject={report?.project}
              buildHref={(otherId) => withBase(`/reports/compare?a=${otherId}&b=${id}`)}
            />
          ))}
        {id && (
          <Link
            to={withBase(
              `/failures/clusters?reportId=${id}${
                report?.project ? `&project=${encodeURIComponent(report.project)}` : ''
              }`
            )}
          >
            <Button variant="outline" size="sm" className="gap-2">
              <Users className="h-4 w-4" />
              Failure clusters
            </Button>
          </Link>
        )}
        <RegressionHeaderChip regressions={report?.regressions} />
      </div>
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
        </div>
        <div className="md:w-3/4 max-w-full">
          {report && <FileList report={report} highlightTestId={highlightTestId} />}
        </div>
      </div>
    </>
  );
}

export default ReportDetailPage;
