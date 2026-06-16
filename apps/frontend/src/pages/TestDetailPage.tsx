import type { ApiResponse, TestDetail } from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import FormattedDate from '@/components/date-format';
import { DurationTrend } from '@/components/test-detail/DurationTrend';
import { FailurePatternsWithClusters } from '@/components/test-detail/FailurePatterns';
import {
  CollapsibleSection,
  formatDaysOpen,
  outcomeBadge,
  StatTile,
  servedReportUrl,
} from '@/components/test-detail/test-detail-widgets';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';

export default function TestDetailPage() {
  const { testId = '' } = useParams<{ testId: string }>();
  const [searchParams] = useSearchParams();
  const project = searchParams.get('project') ?? defaultProjectName;

  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only deps
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [testId]);

  const detailUrl = `/api/test/${testId}/detail?project=${encodeURIComponent(project)}`;
  const { data, isLoading, error } = useQuery<ApiResponse<TestDetail>>(detailUrl, {
    dependencies: [testId, project],
  });

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const detail = data?.data;
  const recentRuns = useMemo(
    () =>
      detail
        ? [...detail.runs]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 50)
        : [],
    [detail]
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <RouterLink to="/analytics">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to dashboard
          </Button>
        </RouterLink>
        <Alert>No detail found for this test.</Alert>
      </div>
    );
  }

  const { stats, runs, failureGroups, crossProject } = detail;

  return (
    <div className="space-y-6">
      <div>
        <RouterLink to="/analytics">
          <Button variant="ghost" size="sm" className="mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to dashboard
          </Button>
        </RouterLink>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold break-words">{detail.title}</h1>
            <p className="text-sm text-muted-foreground break-all mt-1">{detail.filePath}</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="secondary">{detail.project}</Badge>
            {detail.isQuarantined && <Badge variant="destructive">🔒 Quarantined</Badge>}
            {detail.regression && (
              <Badge variant="destructive" title="green → red transition, currently open">
                Regression · {formatDaysOpen(detail.regression.daysOpen)}
              </Badge>
            )}
            {typeof detail.flakinessScore === 'number' && (
              <Badge variant="outline">Flakiness {detail.flakinessScore.toFixed(1)}%</Badge>
            )}
          </div>
        </div>
        {detail.isQuarantined && detail.quarantineReason && (
          <Alert className="mt-3 text-sm">
            <strong>Quarantine reason:</strong> {detail.quarantineReason}
          </Alert>
        )}
        {detail.regression && (
          <Alert className="mt-3 text-sm">
            <div>
              <strong>Active regression:</strong> opened{' '}
              {new Date(detail.regression.regressedAt).toLocaleString()} ·{' '}
              {detail.regression.failureCount} failing run
              {detail.regression.failureCount === 1 ? '' : 's'} since.
              {detail.regression.regressedAtCommit && detail.regression.lastGreenCommit ? (
                <>
                  {' '}
                  Suspect range:{' '}
                  <code className="text-xs">{detail.regression.lastGreenCommit.slice(0, 12)}</code>
                  {' → '}
                  <code className="text-xs">
                    {detail.regression.regressedAtCommit.slice(0, 12)}
                  </code>
                  .
                </>
              ) : detail.regression.regressedAtCommit ? (
                <>
                  {' '}
                  First red commit:{' '}
                  <code className="text-xs">
                    {detail.regression.regressedAtCommit.slice(0, 12)}
                  </code>
                  .
                </>
              ) : null}
            </div>
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Total Runs" value={stats.totalRuns.toLocaleString()} />
        <StatTile label="Pass Rate" value={`${stats.passRate.toFixed(1)}%`} />
        <StatTile
          label="Outcomes"
          value={`${stats.passed} / ${stats.failed} / ${stats.flaky}`}
          hint="pass / fail / flaky"
        />
        <StatTile
          label="Last Run"
          value={stats.lastRunAt ? new Date(stats.lastRunAt).toLocaleDateString() : '—'}
          hint={
            stats.lastRunAt
              ? new Date(stats.lastRunAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : undefined
          }
        />
        <StatTile
          label="Mean Duration"
          value={stats.duration ? formatDuration(stats.duration.mean) : '—'}
          hint={
            stats.duration
              ? `standard deviation ${formatDuration(stats.duration.stdDev)}`
              : undefined
          }
          info="Mean is the average duration across all runs. Standard deviation shows how much individual run durations vary from that mean — a smaller value means more consistent timings, a larger value means runs are spread out."
        />
        <StatTile
          label="p95 Duration"
          value={stats.duration ? formatDuration(stats.duration.p95) : '—'}
          hint={stats.duration ? `median ${formatDuration(stats.duration.median)}` : undefined}
          info="p95 is the duration that 95% of runs finished within — useful for spotting worst-case outliers. The median is the middle value: half of runs were faster, half slower."
        />
      </div>

      <DurationTrend
        runs={runs}
        mean={stats.duration?.mean}
        p95={stats.duration?.p95}
        stdDev={stats.duration?.stdDev}
        testId={testId}
      />

      <FailurePatternsWithClusters
        groups={failureGroups}
        testId={testId}
        fileId={detail.fileId}
        project={project}
      />

      <CollapsibleSection
        title="Run History"
        meta={`Showing ${recentRuns.length} of ${runs.length}`}
      >
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Report</TableHead>
                <TableHead>Failure Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentRuns.map((run) => (
                <TableRow key={run.runId}>
                  <TableCell className="whitespace-nowrap">
                    <FormattedDate date={run.createdAt} />
                  </TableCell>
                  <TableCell>{outcomeBadge(run.outcome)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {typeof run.duration === 'number' ? formatDuration(run.duration) : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <a
                      href={servedReportUrl(run.reportId, testId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline text-sm"
                    >
                      {run.reportDisplayNumber
                        ? `#${run.reportDisplayNumber}`
                        : run.reportId.slice(0, 8)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {run.failureCategory ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
              {recentRuns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                    No runs recorded
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CollapsibleSection>

      {crossProject.length > 0 && (
        <CollapsibleSection
          title="Same Test in Other Projects"
          subtitle={`The same test runs in ${crossProject.length} other ${
            crossProject.length === 1 ? 'project' : 'projects'
          }`}
        >
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead>Flakiness</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crossProject.map((row) => (
                  <TableRow key={`${row.project}-${row.fileId}`}>
                    <TableCell className="font-medium">{row.project}</TableCell>
                    <TableCell>{row.totalRuns}</TableCell>
                    <TableCell>
                      {typeof row.flakinessScore === 'number'
                        ? `${row.flakinessScore.toFixed(1)}%`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {row.isQuarantined ? (
                        <Badge variant="destructive">🔒 Quarantined</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {row.lastRunAt ? new Date(row.lastRunAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>
                      <RouterLink to={`/test/${testId}?project=${encodeURIComponent(row.project)}`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </RouterLink>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
