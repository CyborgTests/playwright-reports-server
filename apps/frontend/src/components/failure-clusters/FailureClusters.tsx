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
} from '@playwright-reports/shared';
import { AlertOctagon, ExternalLink, GitMerge, HelpCircle, RotateCcw, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import DateRangeSelect from '@/components/date-range-select';
import { MarkClusterResolvedDialog } from '@/components/failure-clusters/MarkClusterResolvedDialog';
import { subtitle, title } from '@/components/primitives';
import ProjectSelect from '@/components/project-select';
import ReportPicker from '@/components/report-picker';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import useMutation from '@/hooks/useMutation';
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

  const [project, setProject] = useState(searchParams.get('project') ?? defaultProjectName);
  const [reportId, setReportId] = useState<string | undefined>(
    searchParams.get('reportId') ?? undefined
  );
  const [clusterId, setClusterId] = useState<string | undefined>(
    searchParams.get('clusterId') ?? undefined
  );
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  }));
  const [includeResolved, setIncludeResolved] = useState(
    searchParams.get('includeResolved') === '1' || !!searchParams.get('clusterId')
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (project && project !== defaultProjectName) next.set('project', project);
    if (reportId) next.set('reportId', reportId);
    if (clusterId) next.set('clusterId', clusterId);
    if (dateRange.from) next.set('from', dateRange.from);
    if (dateRange.to) next.set('to', dateRange.to);
    if (includeResolved) next.set('includeResolved', '1');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [project, reportId, clusterId, dateRange, includeResolved, searchParams, setSearchParams]);

  const hasFilters =
    project !== defaultProjectName ||
    !!reportId ||
    !!clusterId ||
    !!dateRange.from ||
    !!dateRange.to ||
    includeResolved;

  const clearFilters = useCallback(() => {
    setProject(defaultProjectName);
    setReportId(undefined);
    setClusterId(undefined);
    setDateRange({ from: undefined, to: undefined });
    setIncludeResolved(false);
  }, []);

  const queryUrl = useMemo(() => {
    const params: Record<string, string> = {};
    if (project && project !== defaultProjectName) params.project = project;
    if (dateRange.from) params.from = dateRange.from;
    if (dateRange.to) params.to = dateRange.to;
    if (reportId) params.reportId = reportId;
    if (clusterId) params.clusterId = clusterId;
    if (includeResolved) params.includeResolved = '1';
    return buildUrl('/api/analytics/failure-clusters', params);
  }, [project, dateRange.from, dateRange.to, reportId, clusterId, includeResolved]);

  const { data, error, isLoading, isFetching, refetch } = useQuery<ClusterReportEnvelope>(
    queryUrl,
    {
      dependencies: [project, dateRange.from, dateRange.to, reportId, clusterId, includeResolved],
      select: (raw: unknown) => raw as ClusterReportEnvelope,
      staleTime: 20_000,
    }
  );

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const report = data?.data;
  const clusters = report?.clusters ?? [];

  return (
    <div className="w-full">
      <h1 className={`${title()} mb-2`}>Failure clusters</h1>
      <p className={`${subtitle()} mb-2`}>
        Groups of failing tests likely caused by the same underlying defect.
      </p>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <ProjectSelect
            entity="report"
            selectedProject={project}
            onSelect={setProject}
            className="w-56"
          />
          <ReportPicker
            selectedReportId={reportId}
            onSelect={setReportId}
            defaultProject={project}
          />
          <DateRangeSelect selectedRange={dateRange} onSelect={setDateRange} disablePersistence />
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="include-resolved"
              checked={includeResolved}
              onCheckedChange={setIncludeResolved}
            />
            <Label htmlFor="include-resolved" className="text-sm cursor-pointer">
              Show resolved
            </Label>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="gap-1.5 pb-2" onClick={clearFilters}>
              <RotateCcw className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {clusterId && (
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <span>
            Filtered to cluster <code className="text-xs">{clusterId.slice(0, 12)}</code>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => setClusterId(undefined)}
          >
            Clear
          </Button>
        </div>
      )}

      {(isLoading || isFetching) && clusters.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : clusters.length === 0 ? (
        <EmptyState reportScoped={!!reportId} />
      ) : (
        <ClusterList
          clusters={clusters}
          reportId={reportId}
          deepLinkClusterId={clusterId}
          project={project}
          onChange={refetch}
        />
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

function ClusterList({
  clusters,
  reportId,
  deepLinkClusterId,
  project,
  onChange,
}: {
  clusters: FailureCluster[];
  reportId?: string;
  deepLinkClusterId?: string;
  project: string;
  onChange: () => void;
}) {
  const actionable = clusters.filter((c) => c.anchor.kind !== 'unmatched');
  const unmatched = clusters.filter((c) => c.anchor.kind === 'unmatched');

  const [openActionable, setOpenActionable] = useState<string[]>(() =>
    deepLinkClusterId && actionable.some((c) => c.id === deepLinkClusterId)
      ? [deepLinkClusterId]
      : []
  );
  const [openUnmatched, setOpenUnmatched] = useState<string[]>(() =>
    deepLinkClusterId && unmatched.some((c) => c.id === deepLinkClusterId)
      ? [deepLinkClusterId]
      : []
  );

  useEffect(() => {
    if (!deepLinkClusterId) return;
    const el = document.getElementById(`cluster-${deepLinkClusterId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [deepLinkClusterId]);

  return (
    <div className="space-y-3">
      {actionable.length > 0 && (
        <Accordion
          type="multiple"
          className="space-y-3"
          value={openActionable}
          onValueChange={setOpenActionable}
        >
          {actionable.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              reportId={reportId}
              project={project}
              onChange={onChange}
            />
          ))}
        </Accordion>
      )}
      {unmatched.length > 0 && (
        <>
          <div className="text-xs uppercase tracking-wide text-muted-foreground pt-4 mb-2 px-1">
            Unmatched failures ({unmatched.length}) — no extractable mechanism
          </div>
          <Accordion
            type="multiple"
            className="space-y-3"
            value={openUnmatched}
            onValueChange={setOpenUnmatched}
          >
            {unmatched.map((cluster) => (
              <ClusterCard
                key={cluster.id}
                cluster={cluster}
                reportId={reportId}
                project={project}
                onChange={onChange}
              />
            ))}
          </Accordion>
        </>
      )}
    </div>
  );
}

function ClusterCard({
  cluster,
  reportId,
  project,
  onChange,
}: {
  cluster: FailureCluster;
  reportId?: string;
  project: string;
  onChange: () => void;
}) {
  const kind = cluster.anchor.kind;
  const resolved = cluster.lifecycle === 'resolved';
  const manualResolution = cluster.resolution?.manual === true;
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);

  const markMutation = useMutation<{ success: boolean }, Record<string, unknown>>(
    `/api/analytics/failure-clusters/${cluster.id}/resolve`,
    {
      method: 'POST',
      onSuccess: () => {
        toast.success('Cluster marked as resolved');
        setResolveDialogOpen(false);
        onChange();
      },
    }
  );
  const reopenMutation = useMutation<{ success: boolean }, Record<string, unknown>>(
    `/api/analytics/failure-clusters/${cluster.id}/reopen`,
    {
      method: 'POST',
      onSuccess: () => {
        toast.success('Cluster re-opened');
        onChange();
      },
    }
  );

  const handleResolveSubmit = (input: { note?: string }) => {
    const body: Record<string, unknown> = { project };
    if (input.note) body.note = input.note;
    markMutation.mutate({ body });
  };
  const handleUnresolve = () => {
    reopenMutation.mutate({ body: { project } });
  };

  return (
    <Card
      id={`cluster-${cluster.id}`}
      className={resolved ? 'opacity-70 border-success/30' : undefined}
    >
      <AccordionItem value={cluster.id} className="border-b-0">
        <AccordionTrigger className="px-6 hover:no-underline">
          <div className="flex flex-1 flex-col items-start gap-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              {resolved && (
                <Badge
                  variant="outline"
                  className="border-success/40 text-success gap-1"
                  title={
                    manualResolution
                      ? `Marked resolved${cluster.resolution?.note ? ` — ${cluster.resolution.note}` : ''}`
                      : 'All member regressions resolved'
                  }
                >
                  {manualResolution ? 'resolved (manual)' : 'resolved'}
                </Badge>
              )}
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
            <RegressionClusterCallout cluster={cluster} />
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6">
          <div className="flex justify-end gap-2 mb-3">
            {resolved ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnresolve}
                disabled={reopenMutation.isPending}
              >
                Re-open cluster
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResolveDialogOpen(true)}
                disabled={markMutation.isPending}
              >
                Mark as resolved
              </Button>
            )}
          </div>
          {resolved && cluster.resolution?.note && (
            <div className="mb-3 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
              <div className="font-medium text-xs uppercase tracking-wide text-success mb-1">
                Resolution note
              </div>
              <div>{cluster.resolution.note}</div>
              {cluster.resolution.resolvedAt && (
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(cluster.resolution.resolvedAt).toLocaleString()}
                </div>
              )}
            </div>
          )}
          <ClusterBody cluster={cluster} reportId={reportId} />
        </AccordionContent>
      </AccordionItem>
      <MarkClusterResolvedDialog
        open={resolveDialogOpen}
        onOpenChange={setResolveDialogOpen}
        clusterName={cluster.name}
        isPending={markMutation.isPending}
        onSubmit={handleResolveSubmit}
      />
    </Card>
  );
}

function RegressionClusterCallout({ cluster }: { cluster: FailureCluster }) {
  const ctx = cluster.regressionContext;
  if (!ctx || ctx.membersInRegression === 0) return null;
  const isDeployInduced = !!ctx.sharedRegressionCommit;
  return (
    <div
      className={`mt-1 flex items-start gap-2 rounded border px-2 py-1.5 text-xs ${
        isDeployInduced
          ? 'border-danger/40 bg-danger/5 text-danger'
          : 'border-warning/40 bg-warning/5 text-warning'
      }`}
    >
      <AlertOctagon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div>
        {isDeployInduced ? (
          <>
            <strong>Deploy-induced cluster:</strong> {ctx.membersInRegression} of {ctx.totalMembers}{' '}
            members regressed at commit{' '}
            <code className="text-[11px]">{ctx.sharedRegressionCommit?.slice(0, 12)}</code>.
          </>
        ) : (
          <>
            {ctx.membersInRegression} of {ctx.totalMembers} cluster members are sitting on open
            regressions (commits differ).
          </>
        )}
      </div>
    </div>
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
