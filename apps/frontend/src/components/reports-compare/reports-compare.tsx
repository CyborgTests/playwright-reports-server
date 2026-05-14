import { API_ENDPOINTS, type ReportCompareResponse } from '@playwright-reports/shared';
import { ArrowLeft, ArrowLeftRight, ArrowRight } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import FormattedDate from '@/components/date-format';
import { title } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import useQuery from '@/hooks/useQuery';
import { withBase } from '@/lib/url';
import { withQueryParams } from '../../config/network';
import { CompareToPicker } from './compare-to-picker';
import { ReportSummaryCard } from './report-summary-card';
import { TestEntryTable } from './test-entry-table';

export default function ReportsCompare() {
  const [searchParams, setSearchParams] = useSearchParams();
  const a = searchParams.get('a');
  const b = searchParams.get('b');

  const swap = () => {
    if (!a || !b) return;
    const next = new URLSearchParams(searchParams);
    next.set('a', b);
    next.set('b', a);
    setSearchParams(next, { replace: true });
  };

  const hasParams = !!a && !!b;
  const sameReport = a && b && a === b;

  const {
    data: diff,
    isLoading,
    error,
  } = useQuery<ReportCompareResponse>(
    withQueryParams(API_ENDPOINTS.REPORTS_COMPARE, { a: a ?? '', b: b ?? '' }),
    {
      enabled: hasParams && !sameReport,
      dependencies: [a, b],
    }
  );

  if (!hasParams) {
    return (
      <div className="space-y-4">
        <h1 className={title()}>Compare reports</h1>
        <p className="text-muted-foreground">
          Open a report and use the <strong>Compare to</strong> button to pick a second report.
        </p>
        <Link to="/reports" className="text-primary underline-offset-4 hover:underline">
          Back to reports
        </Link>
      </div>
    );
  }

  if (sameReport) {
    return (
      <div className="space-y-4">
        <h1 className={title()}>Compare reports</h1>
        <p className="text-destructive">Cannot compare a report to itself. Pick a different one.</p>
        <Link to={`/report/${a}`} className="text-primary underline-offset-4 hover:underline">
          Back to report
        </Link>
      </div>
    );
  }

  if (isLoading || !diff) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className={title()}>Compare reports</h1>
        <p className="text-destructive">Failed to load comparison: {error.message}</p>
      </div>
    );
  }

  const { reportA, reportB, summary, durationDeltas } = diff;
  const projectMismatch = reportA.project !== reportB.project;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className={title()}>Compare reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Diff of test outcomes and durations between two runs.
          </p>
        </div>
      </div>

      {projectMismatch && (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="py-3 text-sm">
            Heads up — these reports belong to different projects (
            <strong>{reportA.project}</strong> vs <strong>{reportB.project}</strong>). Most tests
            will appear as added/removed rather than diffed.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-stretch">
        <ReportSummaryCard
          label="A — Baseline"
          report={reportA}
          footer={
            <CompareToPicker
              excludeReportIds={[reportA.reportID, reportB.reportID]}
              defaultProject={reportA.project}
              openInNewTab={false}
              triggerLabel="Change baseline"
              buildHref={(picked) =>
                withBase(`/reports/compare?a=${picked}&b=${reportB.reportID}`)
              }
            />
          }
        />
        <div className="flex md:flex-col items-center justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={swap}
            title="Swap baseline and target"
            className="gap-1.5"
          >
            <ArrowLeftRight className="h-4 w-4" />
            Swap
          </Button>
        </div>
        <ReportSummaryCard
          label="B — Target"
          report={reportB}
          footer={
            <CompareToPicker
              excludeReportIds={[reportA.reportID, reportB.reportID]}
              defaultProject={reportB.project}
              openInNewTab={false}
              triggerLabel="Change target"
              buildHref={(picked) =>
                withBase(`/reports/compare?a=${reportA.reportID}&b=${picked}`)
              }
            />
          }
        />
      </div>

      <SummaryStats summary={summary} />

      <Tabs defaultValue="failures" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="failures">
            Failures
            <CountBadge count={summary.newlyFailedCount + summary.stillFailingCount} />
          </TabsTrigger>
          <TabsTrigger value="fixed">
            Fixed
            <CountBadge count={summary.fixedCount} variant="success" />
          </TabsTrigger>
          <TabsTrigger value="flake">
            Flake changes
            <CountBadge count={summary.passToFlakyCount + summary.flakyToPassCount} />
          </TabsTrigger>
          <TabsTrigger value="duration">
            Duration deltas
            <CountBadge count={durationDeltas.length} />
          </TabsTrigger>
          <TabsTrigger value="added-removed">
            Added / removed
            <CountBadge count={summary.newTestsCount + summary.removedTestsCount} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="failures" className="space-y-4 mt-4">
          <Section
            title="Newly failed"
            tone="failure"
            entries={diff.newlyFailed}
            reportAUrl={reportA.reportUrl}
            reportBUrl={reportB.reportUrl}
            showDelta
          />
          <Section
            title="Still failing"
            tone="warning"
            entries={diff.stillFailing}
            reportAUrl={reportA.reportUrl}
            reportBUrl={reportB.reportUrl}
            showDelta
          />
        </TabsContent>

        <TabsContent value="fixed" className="space-y-4 mt-4">
          <Section
            title="Fixed"
            tone="success"
            entries={diff.fixed}
            reportAUrl={reportA.reportUrl}
            reportBUrl={reportB.reportUrl}
            showDelta
          />
        </TabsContent>

        <TabsContent value="flake" className="space-y-4 mt-4">
          <Section
            title="Pass → flaky"
            tone="warning"
            entries={diff.passToFlaky}
            reportAUrl={reportA.reportUrl}
            reportBUrl={reportB.reportUrl}
            showDelta
          />
          <Section
            title="Flaky → pass"
            tone="success"
            entries={diff.flakyToPass}
            reportAUrl={reportA.reportUrl}
            reportBUrl={reportB.reportUrl}
            showDelta
          />
        </TabsContent>

        <TabsContent value="duration" className="space-y-4 mt-4">
          <DurationDeltaTable
            entries={diff.durationDeltas}
            reportAUrl={reportA.reportUrl}
            reportBUrl={reportB.reportUrl}
          />
        </TabsContent>

        <TabsContent value="added-removed" className="space-y-4 mt-4">
          <Section
            title="New tests (in B only)"
            tone="info"
            entries={diff.newTests}
            reportAUrl={reportA.reportUrl}
            reportBUrl={reportB.reportUrl}
          />
          <Section
            title="Removed tests (in A only)"
            tone="muted"
            entries={diff.removedTests}
            reportAUrl={reportA.reportUrl}
            reportBUrl={reportB.reportUrl}
          />
        </TabsContent>
      </Tabs>

      <div className="flex justify-between text-sm">
        <Link
          to={`/report/${reportA.reportID}`}
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Open baseline
        </Link>
        <Link
          to={`/report/${reportB.reportID}`}
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          Open target <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function CountBadge({
  count,
  variant = 'default',
}: {
  count: number;
  variant?: 'default' | 'success';
}) {
  if (!count) return null;
  const cls =
    variant === 'success' ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground';
  return (
    <span
      className={`ml-2 inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {count}
    </span>
  );
}

function SummaryStats({ summary }: { summary: ReportCompareResponse['summary'] }) {
  const items: Array<{ label: string; value: number; tone: string }> = [
    { label: 'Newly failed', value: summary.newlyFailedCount, tone: 'text-failure' },
    { label: 'Fixed', value: summary.fixedCount, tone: 'text-success' },
    { label: 'Still failing', value: summary.stillFailingCount, tone: 'text-warning' },
    { label: 'New tests', value: summary.newTestsCount, tone: 'text-info' },
    { label: 'Removed', value: summary.removedTestsCount, tone: 'text-muted-foreground' },
    {
      label: 'Duration regressions',
      value: summary.durationRegressionsCount,
      tone: 'text-failure',
    },
    {
      label: 'Duration improvements',
      value: summary.durationImprovementsCount,
      tone: 'text-success',
    },
  ];

  return (
    <Card>
      <CardContent className="py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col">
              <span className={`text-2xl font-semibold ${item.tone}`}>{item.value}</span>
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type Tone = 'success' | 'failure' | 'warning' | 'info' | 'muted';

function Section({
  title: heading,
  entries,
  tone,
  reportAUrl,
  reportBUrl,
  showDelta = false,
}: {
  title: string;
  entries: ReportCompareResponse['newlyFailed'];
  tone: Tone;
  reportAUrl: string;
  reportBUrl: string;
  showDelta?: boolean;
}) {
  const toneClass: Record<Tone, string> = {
    success: 'text-success',
    failure: 'text-failure',
    warning: 'text-warning',
    info: 'text-info',
    muted: 'text-muted-foreground',
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <span className={toneClass[tone]}>{heading}</span>
          <span className="text-xs font-normal text-muted-foreground">({entries.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <TestEntryTable
            entries={entries}
            reportAUrl={reportAUrl}
            reportBUrl={reportBUrl}
            showDelta={showDelta}
          />
        )}
      </CardContent>
    </Card>
  );
}

function DurationDeltaTable({
  entries,
  reportAUrl,
  reportBUrl,
}: {
  entries: ReportCompareResponse['durationDeltas'];
  reportAUrl: string;
  reportBUrl: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top duration changes</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No significant duration changes detected.</p>
        ) : (
          <TestEntryTable
            entries={entries}
            reportAUrl={reportAUrl}
            reportBUrl={reportBUrl}
            showDelta
          />
        )}
      </CardContent>
    </Card>
  );
}

export { FormattedDate };
