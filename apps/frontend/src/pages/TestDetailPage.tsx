'use client';

import type {
  ApiResponse,
  TestDetail,
  TestFailureGroup,
  TestRun,
} from '@playwright-reports/shared';
import { ArrowLeft, ExternalLink, GitMerge, Info } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import FormattedDate from '@/components/date-format';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';
import { parseMilliseconds } from '@/lib/time';
import { withBase } from '@/lib/url';

function formatDaysOpen(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h open`;
  return `${Math.round(days * 10) / 10}d open`;
}

function servedReportUrl(reportId: string, testId: string): string {
  return `${withBase(`/api/serve/${reportId}/index.html`)}#?testId=${testId}`;
}

function outcomeBadge(outcome: string) {
  switch (outcome) {
    case 'expected':
    case 'passed':
      return <Badge variant="success">Passed</Badge>;
    case 'flaky':
      return <Badge variant="warning">Flaky</Badge>;
    case 'unexpected':
    case 'failed':
      return <Badge variant="danger">Failed</Badge>;
    case 'skipped':
      return <Badge variant="skipped">Skipped</Badge>;
    default:
      return <Badge variant="secondary">{outcome}</Badge>;
  }
}

const OUTCOME_COLOR: Record<string, string> = {
  expected: 'hsl(var(--success))',
  passed: 'hsl(var(--success))',
  flaky: 'hsl(var(--warning))',
  unexpected: 'hsl(var(--danger))',
  failed: 'hsl(var(--danger))',
  skipped: 'hsl(var(--skipped))',
};

function dotColor(outcome: string): string {
  return OUTCOME_COLOR[outcome] ?? 'hsl(var(--muted-foreground))';
}

function StatTile({
  label,
  value,
  hint,
  info,
}: Readonly<{ label: string; value: string; hint?: string; info?: string }>) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          {info && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info
                    className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help"
                    aria-label={`What is ${label}?`}
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{info}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="text-2xl font-bold mt-1 truncate">{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

interface DurationPoint {
  createdAt: string;
  duration: number;
  outcome: string;
  reportId: string;
  reportDisplayNumber?: number;
  reportTitle?: string;
  isOutlier: boolean;
}

function DurationTooltip({
  active,
  payload,
}: Readonly<{ active?: boolean; payload?: Array<{ payload: DurationPoint }> }>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const reportLabel = p.reportDisplayNumber ? `#${p.reportDisplayNumber}` : p.reportId.slice(0, 8);
  return (
    <div className="rounded-md border bg-popover text-popover-foreground shadow-md p-2.5 text-xs space-y-1 max-w-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">{reportLabel}</span>
        {outcomeBadge(p.outcome)}
        {p.isOutlier && <Badge variant="outline">Outlier</Badge>}
      </div>
      {p.reportTitle && <div className="text-muted-foreground truncate">{p.reportTitle}</div>}
      <div className="text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</div>
      <div>
        <span className="text-muted-foreground">Duration: </span>
        <span className="font-medium">{parseMilliseconds(p.duration)}</span>
      </div>
    </div>
  );
}

interface OutcomeDotProps {
  cx?: number;
  cy?: number;
  payload?: DurationPoint;
  radius?: number;
}

function OutcomeDot({ cx, cy, payload, radius = 4.5 }: OutcomeDotProps) {
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={dotColor(payload.outcome)}
      stroke={payload.isOutlier ? 'hsl(var(--danger))' : 'transparent'}
      strokeWidth={2}
    />
  );
}

function DurationTrend({
  runs,
  mean,
  p95,
  stdDev,
  testId,
}: Readonly<{
  runs: TestRun[];
  mean?: number;
  p95?: number;
  stdDev?: number;
  testId: string;
}>) {
  const data = useMemo<DurationPoint[]>(
    () =>
      [...runs]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .filter((r) => typeof r.duration === 'number')
        .map((r) => {
          const duration = r.duration ?? 0;
          const isOutlier =
            typeof mean === 'number' &&
            typeof stdDev === 'number' &&
            stdDev > 0 &&
            Math.abs(duration - mean) > 2 * stdDev;
          return {
            createdAt: r.createdAt,
            duration,
            outcome: r.outcome,
            reportId: r.reportId,
            reportDisplayNumber: r.reportDisplayNumber,
            reportTitle: r.reportTitle,
            isOutlier,
          };
        }),
    [runs, mean, stdDev]
  );

  if (data.length < 2) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Duration Trend</h3>
          <p className="text-sm text-muted-foreground">
            Need at least 2 timed runs to plot a trend
          </p>
        </CardHeader>
      </Card>
    );
  }

  const handleChartClick = (state: { activePayload?: Array<{ payload?: DurationPoint }> }) => {
    const point = state?.activePayload?.[0]?.payload;
    if (!point?.reportId) return;
    window.open(servedReportUrl(point.reportId, testId), '_blank', 'noopener,noreferrer');
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Duration Trend</h3>
        <p className="text-sm text-muted-foreground">
          Per-run duration with mean and p95 reference lines · dot color encodes outcome, red ring
          marks outliers · click a point to open that run's report
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 5, right: 16, bottom: 5, left: 0 }}
              onClick={handleChartClick}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="createdAt"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString()}
              />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => parseMilliseconds(v)} />
              <RechartsTooltip content={<DurationTooltip />} />
              {typeof mean === 'number' && (
                <ReferenceLine y={mean} stroke="hsl(217, 91%, 60%)" strokeDasharray="4 4" />
              )}
              {typeof p95 === 'number' && (
                <ReferenceLine y={p95} stroke="hsl(0, 84%, 60%)" strokeDasharray="4 4" />
              )}
              <Line
                type="monotone"
                dataKey="duration"
                stroke="hsl(217, 91%, 60%)"
                strokeWidth={2}
                dot={(props: unknown) => {
                  const p = props as OutcomeDotProps & { index?: number; key?: string };
                  return <OutcomeDot key={p.key ?? `dot-${p.index}`} {...p} />;
                }}
                activeDot={(props: unknown) => {
                  const p = props as OutcomeDotProps & { index?: number; key?: string };
                  return <OutcomeDot key={p.key ?? `active-${p.index}`} {...p} radius={6} />;
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor('passed') }}
              aria-hidden
            />
            Passed
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor('failed') }}
              aria-hidden
            />
            Failed
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor('flaky') }}
              aria-hidden
            />
            Flaky
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor('skipped') }}
              aria-hidden
            />
            Skipped
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full bg-transparent"
              style={{ boxShadow: 'inset 0 0 0 2px hsl(var(--danger))' }}
              aria-hidden
            />
            Outlier (&gt;2σ from mean)
          </span>
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-6 border-t-2 border-dashed"
              style={{ borderColor: 'hsl(217, 91%, 60%)' }}
              aria-hidden
            />
            Mean {typeof mean === 'number' ? `· ${parseMilliseconds(mean)}` : ''}
          </span>
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-6 border-t-2 border-dashed"
              style={{ borderColor: 'hsl(0, 84%, 60%)' }}
              aria-hidden
            />
            p95 {typeof p95 === 'number' ? `· ${parseMilliseconds(p95)}` : ''}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CollapsibleSection({
  title,
  subtitle,
  meta,
  defaultOpen = true,
  children,
}: Readonly<{
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <Card>
      <Accordion type="single" collapsible defaultValue={defaultOpen ? 'open' : undefined}>
        <AccordionItem value="open" className="border-b-0">
          <AccordionTrigger className="px-6 py-4 hover:no-underline">
            <div className="flex flex-1 items-center justify-between gap-3 pr-2 min-w-0">
              <div className="text-left min-w-0">
                <h3 className="text-lg font-semibold leading-tight">{title}</h3>
                {subtitle && (
                  <p className="text-sm text-muted-foreground mt-1 font-normal">{subtitle}</p>
                )}
              </div>
              {meta && (
                <span className="text-sm text-muted-foreground font-normal shrink-0">{meta}</span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="px-6 pt-2">{children}</div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

function firstLine(message: string): string {
  const trimmed = message.trim();
  const newlineIdx = trimmed.search(/\r?\n/);
  return newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
}

function FailureGroupsList({
  groups,
  testId,
}: Readonly<{ groups: TestFailureGroup[]; testId: string }>) {
  if (groups.length === 0) return null;
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-lg font-semibold">Failure clusters</h3>
        <p className="text-sm text-muted-foreground">
          Failures for this test grouped by error signature
        </p>
      </div>
      <Accordion type="multiple" className="space-y-3">
        {groups.map((group) => (
          <FailureClusterCard key={group.signature} group={group} testId={testId} />
        ))}
      </Accordion>
    </div>
  );
}

function FailureClusterCard({
  group,
  testId,
}: Readonly<{ group: TestFailureGroup; testId: string }>) {
  const name = firstLine(group.sampleMessage || group.signature);
  return (
    <Card>
      <AccordionItem value={group.signature} className="border-b-0">
        <AccordionTrigger className="px-6 hover:no-underline">
          <div className="flex flex-1 flex-col items-start gap-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <GitMerge className="h-3 w-3" />
                signature
              </Badge>
              {group.category && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {group.category}
                </Badge>
              )}
            </div>
            <CardTitle className="text-base font-medium leading-snug break-words">{name}</CardTitle>
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{group.count}</span>{' '}
              {group.count === 1 ? 'occurrence' : 'occurrences'} ·{' '}
              <span>
                first <FormattedDate date={group.firstSeen} />
              </span>{' '}
              ·{' '}
              <span>
                last <FormattedDate date={group.lastSeen} />
              </span>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6">
          <div className="space-y-4">
            {group.sampleMessage && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  Sample error
                </div>
                <pre className="bg-muted rounded p-3 text-xs whitespace-pre-wrap break-words font-mono">
                  {group.sampleMessage}
                </pre>
              </div>
            )}
            {group.recentReports.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Recent reports
                </div>
                <ul className="space-y-1">
                  {group.recentReports.map((ref) => {
                    const label = ref.displayNumber
                      ? `#${ref.displayNumber}${ref.title ? ` ${ref.title}` : ''}`
                      : (ref.title ?? ref.reportId.slice(0, 8));
                    return (
                      <li key={ref.reportId}>
                        <a
                          href={servedReportUrl(ref.reportId, testId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm hover:underline inline-flex items-baseline gap-1"
                          title={ref.title ?? ref.reportId}
                        >
                          {label}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Card>
  );
}

export default function TestDetailPage() {
  const { testId = '' } = useParams<{ testId: string }>();
  const [searchParams] = useSearchParams();
  const project = searchParams.get('project') ?? defaultProjectName;

  // Always land at the top when navigating in to a different test — without
  // this, the browser may restore the previous page's scroll position and
  // drop the user into the middle of the new test's content. testId is
  // unused inside the effect but serves as the trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only deps
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [testId]);

  const detailUrl = `/api/test/${testId}/detail?project=${encodeURIComponent(project)}`;
  const { data, isLoading, error } = useQuery<ApiResponse<TestDetail>>(detailUrl, {
    dependencies: [testId, project],
  });

  error && toast.error(error.message);

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
        <RouterLink to="/">
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
        <RouterLink to="/">
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
          value={stats.duration ? parseMilliseconds(stats.duration.mean) : '—'}
          hint={
            stats.duration
              ? `standard deviation ${parseMilliseconds(stats.duration.stdDev)}`
              : undefined
          }
          info="Mean is the average duration across all runs. Standard deviation shows how much individual run durations vary from that mean — a smaller value means more consistent timings, a larger value means runs are spread out."
        />
        <StatTile
          label="p95 Duration"
          value={stats.duration ? parseMilliseconds(stats.duration.p95) : '—'}
          hint={stats.duration ? `median ${parseMilliseconds(stats.duration.median)}` : undefined}
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

      <FailureGroupsList groups={failureGroups} testId={testId} />

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
                    {typeof run.duration === 'number' ? parseMilliseconds(run.duration) : '—'}
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
