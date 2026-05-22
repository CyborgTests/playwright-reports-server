'use client';

import type {
  ClusterFellowTraveller,
  ClusterReport,
  ClusterStrategy,
  ClusterTest,
  DateRange,
  FailureCluster,
  ReportHistory,
} from '@playwright-reports/shared';
import { ExternalLink, GitMerge, HelpCircle, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import DateRangeSelect from '@/components/date-range-select';
import { subtitle, title } from '@/components/primitives';
import ProjectSelect from '@/components/project-select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';
import { buildUrl, withBase } from '@/lib/url';

interface ClusterReportEnvelope {
  success: boolean;
  data: ClusterReport;
  error?: string;
}

const STRATEGY_LABELS: Record<FailureCluster['strategy'], string> = {
  signature: 'Shared error signature',
  'stack-frame': 'Shared stack frame',
  fixture: 'Fixture failure',
  temporal: 'Temporal co-failure',
};

const ALL_STRATEGIES: ClusterStrategy[] = ['signature', 'stack-frame', 'fixture', 'temporal'];

const STRATEGY_SHORT_LABELS: Record<ClusterStrategy, string> = {
  signature: 'Signature',
  'stack-frame': 'Stack frame',
  fixture: 'Fixture',
  temporal: 'Temporal',
};

const STRATEGY_DESCRIPTIONS: Record<ClusterStrategy, string> = {
  signature:
    'Groups tests whose error messages normalize to the same signature — strongest evidence that one fix resolves all.',
  'stack-frame':
    'Groups tests that crash at the same line of app code (Playwright internals and node_modules frames are ignored).',
  fixture:
    'Detects beforeAll/beforeEach/afterAll/afterEach failures where every test in a file cascades from the same hook error.',
  temporal:
    'Pairs of tests that consistently fail together in the same reports — catches infra and shared-data issues whose surface errors differ.',
};

function parseStrategies(value: string | null): ClusterStrategy[] {
  if (!value) return ALL_STRATEGIES;
  const parsed = value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ClusterStrategy => (ALL_STRATEGIES as string[]).includes(s));
  return parsed.length > 0 ? parsed : ALL_STRATEGIES;
}

function buildTestLink(reportUrl: string | undefined, testId: string): string | undefined {
  if (!reportUrl) return undefined;
  return `${withBase(reportUrl)}#?testId=${testId}`;
}

export default function FailureClusters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const reportId = searchParams.get('reportId') ?? undefined;

  const [project, setProject] = useState(searchParams.get('project') ?? defaultProjectName);
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  }));
  const [strategies, setStrategies] = useState<ClusterStrategy[]>(() =>
    parseStrategies(searchParams.get('strategies'))
  );

  const toggleStrategy = (strategy: ClusterStrategy) => {
    setStrategies((current) => {
      const has = current.includes(strategy);
      const next = has ? current.filter((s) => s !== strategy) : [...current, strategy];
      // Refuse to deselect the last remaining strategy — empty selection
      // would mean "fetch nothing" which is never the user's intent.
      return next.length === 0 ? current : next;
    });
  };

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (project && project !== defaultProjectName) next.set('project', project);
    else next.delete('project');
    if (dateRange.from) next.set('from', dateRange.from);
    else next.delete('from');
    if (dateRange.to) next.set('to', dateRange.to);
    else next.delete('to');
    const isDefaultStrategies =
      strategies.length === ALL_STRATEGIES.length &&
      ALL_STRATEGIES.every((s) => strategies.includes(s));
    if (isDefaultStrategies) next.delete('strategies');
    else next.set('strategies', strategies.join(','));
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [project, dateRange, strategies, searchParams, setSearchParams]);

  const queryUrl = useMemo(() => {
    const params: Record<string, string> = {};
    if (project && project !== defaultProjectName) params.project = project;
    if (dateRange.from) params.from = dateRange.from;
    if (dateRange.to) params.to = dateRange.to;
    if (reportId) params.reportId = reportId;
    if (strategies.length > 0 && strategies.length < ALL_STRATEGIES.length) {
      params.strategies = strategies.join(',');
    }
    return buildUrl('/api/analytics/failure-clusters', params);
  }, [project, dateRange.from, dateRange.to, reportId, strategies]);

  const strategiesKey = strategies.join(',');
  const { data, error, isLoading, isFetching } = useQuery<ClusterReportEnvelope>(queryUrl, {
    dependencies: [project, dateRange.from, dateRange.to, reportId, strategiesKey],
    select: (raw: unknown) => raw as ClusterReportEnvelope,
    staleTime: 30_000,
  });

  // Fetch the scoping report's basic info so we can give the user something
  // concrete (e.g. "Report #42") instead of an unexplained "Scoped to a report" badge.
  const { data: scopingReport } = useQuery<ReportHistory>(`/api/report/${reportId}`, {
    enabled: !!reportId,
    dependencies: [reportId],
    select: (raw: unknown) => {
      if (raw && typeof raw === 'object' && 'data' in raw) {
        return (raw as { data: ReportHistory }).data;
      }
      return raw as ReportHistory;
    },
  });

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const report = data?.data;
  const clusters = report?.clusters ?? [];

  const scopeLabel = useMemo(() => {
    if (!reportId) return undefined;
    if (!scopingReport) return `report ${reportId.slice(0, 8)}`;
    const parts: string[] = [];
    if (scopingReport.displayNumber !== undefined) parts.push(`#${scopingReport.displayNumber}`);
    if (scopingReport.title) parts.push(scopingReport.title);
    return parts.length > 0 ? parts.join(' ') : `report ${reportId.slice(0, 8)}`;
  }, [reportId, scopingReport]);

  return (
    <div className="w-full">
      <h1 className={`${title()} mb-2`}>Failure clusters</h1>
      <p className={`${subtitle()} mb-2`}>
        Groups of failing tests likely caused by the same underlying defect.
      </p>
      {reportId && scopeLabel && (
        <p className="text-sm text-muted-foreground mb-6">
          Showing only clusters that contain tests that failed in{' '}
          <span className="font-medium text-foreground">{scopeLabel}</span>.
        </p>
      )}

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <ProjectSelect
            entity="report"
            selectedProject={project}
            onSelect={setProject}
            className="w-56"
          />
          <DateRangeSelect selectedRange={dateRange} onSelect={setDateRange} disablePersistence />
          <div className="flex flex-col gap-1.5">
            <Label>Strategies</Label>
            <TooltipProvider delayDuration={200}>
              <div className="flex flex-wrap gap-3 pb-2">
                {ALL_STRATEGIES.map((s) => {
                  const id = `cluster-strategy-${s}`;
                  return (
                    <div key={s} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        id={id}
                        checked={strategies.includes(s)}
                        onCheckedChange={() => toggleStrategy(s)}
                      />
                      <Label htmlFor={id} className="cursor-pointer font-normal">
                        {STRATEGY_SHORT_LABELS[s]}
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`What is ${STRATEGY_SHORT_LABELS[s]}?`}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          {STRATEGY_DESCRIPTIONS[s]}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      {(isLoading || isFetching) && clusters.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : clusters.length === 0 ? (
        <EmptyState reportScoped={!!reportId} />
      ) : (
        <ClusterList clusters={clusters} reportId={reportId} />
      )}
    </div>
  );
}

function EmptyState({ reportScoped }: { reportScoped: boolean }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <div className="text-lg">No failure clusters found</div>
        <div className="text-sm mt-2 max-w-md mx-auto">
          {reportScoped
            ? "None of this report's failed tests share a known failure pattern with other tests."
            : 'Adjust the project, date range, or strategy selection to broaden the search.'}
        </div>
      </CardContent>
    </Card>
  );
}

function ClusterList({ clusters, reportId }: { clusters: FailureCluster[]; reportId?: string }) {
  return (
    <Accordion type="multiple" className="space-y-3">
      {clusters.map((cluster) => (
        <ClusterCard key={cluster.id} cluster={cluster} reportId={reportId} />
      ))}
    </Accordion>
  );
}

function ClusterCard({ cluster, reportId }: { cluster: FailureCluster; reportId?: string }) {
  return (
    <Card>
      <AccordionItem value={cluster.id} className="border-b-0">
        <AccordionTrigger className="px-6 hover:no-underline">
          <div className="flex flex-1 flex-col items-start gap-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <GitMerge className="h-3 w-3" />
                {STRATEGY_LABELS[cluster.strategy]}
              </Badge>
              {cluster.category && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {cluster.category}
                </Badge>
              )}
              {cluster.evidence.secondaryEvidence?.map((evidence) => (
                <Badge key={evidence.strategy} variant="outline" className="text-xs">
                  also: {STRATEGY_SHORT_LABELS[evidence.strategy].toLowerCase()}
                  {evidence.count > 1 ? ` ×${evidence.count}` : ''}
                </Badge>
              ))}
            </div>
            <CardTitle className="text-base font-medium leading-snug">{cluster.name}</CardTitle>
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{cluster.testCount}</span> tests ·{' '}
              <span className="font-semibold text-foreground">{cluster.failureCount}</span> failures
              · <span className="text-foreground">assuming same root cause</span>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6">
          <ClusterBody cluster={cluster} reportId={reportId} />
        </AccordionContent>
      </AccordionItem>
    </Card>
  );
}

function ClusterBody({ cluster, reportId }: { cluster: FailureCluster; reportId?: string }) {
  return (
    <div className="space-y-4">
      {cluster.sampleMessage && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            {cluster.strategy === 'temporal'
              ? 'One example error (errors differ across tests)'
              : 'Sample error'}
          </div>
          <pre className="bg-muted rounded p-3 text-xs whitespace-pre-wrap break-words font-mono">
            {cluster.sampleMessage}
          </pre>
        </div>
      )}
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Tests in this cluster
        </div>
        <ul className="space-y-3">
          {cluster.tests.map((test) => (
            <ClusterTestRow
              key={`${test.project}-${test.fileId}-${test.testId}`}
              test={test}
              highlight={!!reportId}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function TestTitleLink({
  title,
  testId,
  reportUrl,
  className,
}: {
  title: string;
  testId: string;
  reportUrl?: string;
  className?: string;
}) {
  const href = buildTestLink(reportUrl, testId);
  if (!href) {
    return <span className={className}>{title}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`${className ?? ''} inline-flex items-baseline gap-1 hover:underline`}
    >
      {title}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function ClusterTestRow({ test, highlight }: { test: ClusterTest; highlight: boolean }) {
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <TestTitleLink
          title={test.title}
          testId={test.testId}
          reportUrl={test.lastReportUrl}
          className="font-medium"
        />
        <Badge variant="outline" className="text-xs">
          {test.project}
        </Badge>
        {test.matchedOn.map((strategy) => (
          <Badge key={strategy} variant="secondary" className="text-xs">
            {STRATEGY_SHORT_LABELS[strategy].toLowerCase()}
          </Badge>
        ))}
        {highlight && (
          <span className="text-xs text-muted-foreground">{test.occurrences} occurrences</span>
        )}
      </div>
      {test.filePath && (
        <div className="text-xs text-muted-foreground font-mono mt-0.5">{test.filePath}</div>
      )}
      {test.fellowTravellers.length > 0 && (
        <div className="mt-2 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Previously failing alongside
          </div>
          <ul className="space-y-0.5">
            {test.fellowTravellers.map((fellow: ClusterFellowTraveller) => (
              <li
                key={`${fellow.project}-${fellow.fileId}-${fellow.testId}`}
                className="text-sm text-muted-foreground"
              >
                <TestTitleLink
                  title={fellow.title}
                  testId={fellow.testId}
                  reportUrl={fellow.lastReportUrl}
                  className="text-sm"
                />{' '}
                <span className="text-xs">
                  ({fellow.jointFailureCount} of {test.occurrences} runs,{' '}
                  {Math.round(fellow.jointFailureRate * 100)}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
