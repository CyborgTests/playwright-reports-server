import type { RegressionTestRef, ReportHistory } from '@playwright-reports/shared';
import { AlertOctagon, CheckCircle2, Download, GitCompare, Users } from 'lucide-react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import useQuery from '@/hooks/useQuery';
import { withBase } from '@/lib/url';

function RegressionChip({
  kind,
  count,
  tests,
}: Readonly<{
  kind: 'new' | 'resolved';
  count: number;
  tests?: RegressionTestRef[];
}>) {
  const isNew = kind === 'new';
  const Icon = isNew ? AlertOctagon : CheckCircle2;
  const label = isNew ? 'new' : 'resolved';
  const borderClass = isNew ? 'border-danger/40 text-danger' : 'border-success/40 text-success';
  const visible = tests ?? [];
  const truncatedByBackend = count > visible.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted ${borderClass}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {count} {label} regression{count === 1 ? '' : 's'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-[28rem] overflow-auto">
        <div className="text-sm font-medium mb-2 sticky top-0 bg-popover -mt-1 pt-1 pb-2 border-b border-border/40">
          {count} {label} regression{count === 1 ? '' : 's'} in this report
        </div>
        {visible.length > 0 ? (
          <ul className="space-y-1">
            {visible.map((t) => (
              <li key={`${t.testId}::${t.fileId}::${t.project}`} className="text-xs leading-tight">
                <Link
                  to={withBase(`/test/${t.testId}?project=${encodeURIComponent(t.project)}`)}
                  className="hover:underline"
                  title={t.filePath}
                >
                  {t.title}
                </Link>
                <div className="text-muted-foreground truncate">{t.filePath}</div>
              </li>
            ))}
            {truncatedByBackend && (
              <li className="text-xs text-muted-foreground pt-1">
                + {count - visible.length} more (not loaded)
              </li>
            )}
          </ul>
        ) : (
          <div className="text-xs text-muted-foreground">No test details available.</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RegressionHeaderChips({
  regressions,
}: Readonly<{
  regressions?: {
    newHere: number;
    resolvedHere: number;
    newTests?: RegressionTestRef[];
    resolvedTests?: RegressionTestRef[];
  };
}>) {
  if (!regressions) return null;
  const { newHere, resolvedHere, newTests, resolvedTests } = regressions;
  if (newHere === 0 && resolvedHere === 0) return null;
  return (
    <>
      {newHere > 0 && <RegressionChip kind="new" count={newHere} tests={newTests} />}
      {resolvedHere > 0 && (
        <RegressionChip kind="resolved" count={resolvedHere} tests={resolvedTests} />
      )}
    </>
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
        {id && (
          <a href={withBase(`/api/report/${id}/export.pdf?scope=all&compare=previous`)} download>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          </a>
        )}
        <RegressionHeaderChips regressions={report?.regressions} />
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
