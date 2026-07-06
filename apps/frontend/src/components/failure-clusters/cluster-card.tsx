import {
  CLUSTER_CONFIDENCE_DESCRIPTIONS,
  CLUSTER_CONFIDENCE_LABELS,
  CLUSTER_KIND_DESCRIPTIONS,
  CLUSTER_KIND_LABELS,
  type ClusterAnchor,
  type ClusterTest,
  type FailureCluster,
} from '@playwright-reports/shared';
import { AlertOctagon, ExternalLink, GitMerge, HelpCircle } from 'lucide-react';
import FormattedDate from '@/components/date-format';
import ClusterRootCauseBulkEditor from '@/components/failure-clusters/ClusterRootCauseBulkEditor';
import { MarkClusterResolvedDialog } from '@/components/failure-clusters/MarkClusterResolvedDialog';
import { useClusterResolution } from '@/components/failure-clusters/useClusterResolution';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { withBase } from '@/lib/url';

function buildTestLink(reportUrl: string | undefined, testId: string): string | undefined {
  if (!reportUrl) return undefined;
  return `${withBase(reportUrl)}#?testId=${testId}`;
}

export function ClusterCard({
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
  const resolution = useClusterResolution(cluster.id, project, onChange);

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
                      ? `Marked resolved${cluster.resolution?.note ? ` - ${cluster.resolution.note}` : ''}`
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
            <ClusterRootCauseBulkEditor tests={cluster.tests} />
            {resolved ? (
              <Button
                variant="outline"
                size="sm"
                onClick={resolution.reopen}
                disabled={resolution.reopenPending}
              >
                Re-open cluster
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => resolution.setResolveDialogOpen(true)}
                disabled={resolution.markPending}
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
                  <FormattedDate date={cluster.resolution.resolvedAt} />
                </div>
              )}
            </div>
          )}
          <ClusterBody cluster={cluster} reportId={reportId} />
        </AccordionContent>
      </AccordionItem>
      <MarkClusterResolvedDialog
        open={resolution.resolveDialogOpen}
        onOpenChange={resolution.setResolveDialogOpen}
        clusterName={cluster.name}
        isPending={resolution.markPending}
        onSubmit={resolution.submitResolve}
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
            {ctx.membersInRegression} of {ctx.totalMembers} members have open regressions (commits
            differ).
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
