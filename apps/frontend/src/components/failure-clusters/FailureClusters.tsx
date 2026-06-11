'use client';

import {
  CLUSTER_CONFIDENCE_DESCRIPTIONS,
  CLUSTER_CONFIDENCE_LABELS,
  CLUSTER_KIND_DESCRIPTIONS,
  CLUSTER_KIND_LABELS,
  type ClusterAnchor,
  type ClusterReport,
  type ClusterTest,
  type DateRange,
  type FailureCluster,
  type ReportHistory,
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

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (project && project !== defaultProjectName) next.set('project', project);
    else next.delete('project');
    if (dateRange.from) next.set('from', dateRange.from);
    else next.delete('from');
    if (dateRange.to) next.set('to', dateRange.to);
    else next.delete('to');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [project, dateRange, searchParams, setSearchParams]);

  const queryUrl = useMemo(() => {
    const params: Record<string, string> = {};
    if (project && project !== defaultProjectName) params.project = project;
    if (dateRange.from) params.from = dateRange.from;
    if (dateRange.to) params.to = dateRange.to;
    if (reportId) params.reportId = reportId;
    return buildUrl('/api/analytics/failure-clusters', params);
  }, [project, dateRange.from, dateRange.to, reportId]);

  const { data, error, isLoading, isFetching } = useQuery<ClusterReportEnvelope>(queryUrl, {
    dependencies: [project, dateRange.from, dateRange.to, reportId],
    select: (raw: unknown) => raw as ClusterReportEnvelope,
    staleTime: 20_000,
  });

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
        <div className="text-lg">No failure clusters in this window</div>
        <div className="text-sm mt-2 max-w-md mx-auto">
          {reportScoped
            ? "None of this report's failed tests overlap with any active cluster."
            : 'Adjust the project or date range to broaden the search.'}
        </div>
      </CardContent>
    </Card>
  );
}

function ClusterList({ clusters, reportId }: { clusters: FailureCluster[]; reportId?: string }) {
  const actionable = clusters.filter((c) => c.anchor.kind !== 'unmatched');
  const unmatched = clusters.filter((c) => c.anchor.kind === 'unmatched');
  return (
    <div className="space-y-3">
      {actionable.length > 0 && (
        <Accordion type="multiple" className="space-y-3">
          {actionable.map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} reportId={reportId} />
          ))}
        </Accordion>
      )}
      {unmatched.length > 0 && (
        <>
          <div className="text-xs uppercase tracking-wide text-muted-foreground pt-4 mb-2 px-1">
            Unmatched failures ({unmatched.length}) — no extractable mechanism
          </div>
          <Accordion type="multiple" className="space-y-3">
            {unmatched.map((cluster) => (
              <ClusterCard key={cluster.id} cluster={cluster} reportId={reportId} />
            ))}
          </Accordion>
        </>
      )}
    </div>
  );
}

function ClusterCard({ cluster, reportId }: { cluster: FailureCluster; reportId?: string }) {
  const kind = cluster.anchor.kind;
  return (
    <Card>
      <AccordionItem value={cluster.id} className="border-b-0">
        <AccordionTrigger className="px-6 hover:no-underline">
          <div className="flex flex-1 flex-col items-start gap-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="gap-1 cursor-help">
                      <GitMerge className="h-3 w-3" />
                      {CLUSTER_KIND_LABELS[kind]}
                      <HelpCircle className="h-3 w-3 text-muted-foreground" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    {CLUSTER_KIND_DESCRIPTIONS[kind]}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant={
                        cluster.confidence === 'high'
                          ? 'default'
                          : cluster.confidence === 'medium'
                            ? 'secondary'
                            : 'outline'
                      }
                      className="text-xs cursor-help"
                    >
                      {CLUSTER_CONFIDENCE_LABELS[cluster.confidence]}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    {CLUSTER_CONFIDENCE_DESCRIPTIONS[cluster.confidence]}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {cluster.category && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {cluster.category}
                </Badge>
              )}
            </div>
            <CardTitle className="text-base font-medium leading-snug">{cluster.name}</CardTitle>
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{cluster.testCount}</span> test
              {cluster.testCount === 1 ? '' : 's'} ·{' '}
              <span className="font-semibold text-foreground">{cluster.failureCount}</span> failure
              {cluster.failureCount === 1 ? '' : 's'}
            </div>
            <AnchorDetail anchor={cluster.anchor} />
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6">
          <ClusterBody cluster={cluster} reportId={reportId} />
        </AccordionContent>
      </AccordionItem>
    </Card>
  );
}

function AnchorDetail({ anchor }: { anchor: ClusterAnchor }) {
  switch (anchor.kind) {
    case 'fixture':
      return (
        <div className="text-xs text-muted-foreground font-mono">
          {anchor.phase} hook · {anchor.filePath}
        </div>
      );
    case 'selector':
      return (
        <div className="text-xs text-muted-foreground font-mono break-all">
          verb: <span className="text-foreground">{anchor.verb}</span> · selector:{' '}
          <span className="text-foreground">{anchor.selector}</span>
        </div>
      );
    case 'frame':
      return (
        <div className="text-xs text-muted-foreground font-mono">
          verb: <span className="text-foreground">{anchor.verb}</span> · at{' '}
          <span className="text-foreground">{anchor.frame}</span>
        </div>
      );
    case 'signature':
      return (
        <div className="text-xs text-muted-foreground font-mono break-all">
          verb: <span className="text-foreground">{anchor.verb}</span> · signature:{' '}
          <span className="text-foreground">{anchor.signature.slice(0, 32)}…</span>
        </div>
      );
    case 'unmatched':
      return null;
  }
}

function ClusterBody({ cluster, reportId }: { cluster: FailureCluster; reportId?: string }) {
  return (
    <div className="space-y-4">
      {cluster.sampleMessage && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Sample error
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
        {highlight && (
          <span className="text-xs text-muted-foreground">{test.occurrences} occurrences</span>
        )}
      </div>
      {test.filePath && (
        <div className="text-xs text-muted-foreground font-mono mt-0.5">{test.filePath}</div>
      )}
    </li>
  );
}
