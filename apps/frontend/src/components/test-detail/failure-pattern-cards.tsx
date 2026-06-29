import type { FailureCluster, TestFailureGroup } from '@playwright-reports/shared';
import { ExternalLink, GitMerge } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import FormattedDate from '@/components/date-format';
import { MarkClusterResolvedDialog } from '@/components/failure-clusters/MarkClusterResolvedDialog';
import { useClusterResolution } from '@/components/failure-clusters/useClusterResolution';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { withBase } from '@/lib/url';
import { firstLine } from './failure-pattern-helpers';
import { servedReportUrl } from './test-detail-widgets';

function ClusterActions({
  cluster,
  resolved,
  project,
  onResolve,
  onReopen,
  resolvePending,
  reopenPending,
  forceView = false,
}: Readonly<{
  cluster: FailureCluster;
  resolved: boolean;
  project: string;
  onResolve: () => void;
  onReopen: () => void;
  resolvePending: boolean;
  reopenPending: boolean;
  forceView?: boolean;
}>) {
  return (
    <div
      role="toolbar"
      className="flex items-center gap-2 shrink-0"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      {(forceView || cluster.anchor.kind !== 'signature') && (
        <RouterLink
          to={withBase(
            `/failures/clusters?clusterId=${cluster.id}&project=${encodeURIComponent(project)}`
          )}
        >
          <Button variant="ghost" size="sm">
            View
          </Button>
        </RouterLink>
      )}
      {resolved ? (
        <Button variant="outline" size="sm" onClick={onReopen} disabled={reopenPending}>
          Re-open
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onResolve} disabled={resolvePending}>
          Mark resolved
        </Button>
      )}
    </div>
  );
}

export function CrossTestClusterCard({
  cluster,
  project,
  onChange,
}: Readonly<{ cluster: FailureCluster; project: string; onChange: () => void }>) {
  const resolved = cluster.lifecycle === 'resolved';
  const resolution = useClusterResolution(cluster.id, project, onChange);
  return (
    <Card className={resolved ? 'opacity-70 border-success/30' : undefined}>
      <Accordion type="single" collapsible>
        <AccordionItem value={cluster.id} className="border-b-0">
          {/* Actions are siblings of the trigger, not children - a <button> (the
              trigger) must not contain other buttons/links. */}
          <div className="flex items-start justify-between gap-2">
            <AccordionTrigger className="flex-1 px-6 hover:no-underline">
              <div className="flex flex-col items-start gap-1 min-w-0 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <GitMerge className="h-3 w-3" />
                    {cluster.anchor.kind}
                  </Badge>
                  {resolved && (
                    <Badge variant="outline" className="border-success/40 text-success">
                      resolved
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {cluster.testCount} test{cluster.testCount === 1 ? '' : 's'} ·{' '}
                    {cluster.failureCount} failure{cluster.failureCount === 1 ? '' : 's'}
                  </span>
                </div>
                <CardTitle className="text-sm font-medium leading-snug break-words">
                  {cluster.name}
                </CardTitle>
                {resolved && cluster.resolution?.note && (
                  <div className="text-xs text-muted-foreground italic mt-1">
                    &ldquo;{cluster.resolution.note}&rdquo;
                  </div>
                )}
              </div>
            </AccordionTrigger>
            <div className="pr-6 pt-4">
              <ClusterActions
                cluster={cluster}
                resolved={resolved}
                project={project}
                onResolve={() => resolution.setResolveDialogOpen(true)}
                onReopen={resolution.reopen}
                resolvePending={resolution.markPending}
                reopenPending={resolution.reopenPending}
                forceView
              />
            </div>
          </div>
          <AccordionContent className="px-6 pb-6">
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
              {cluster.tests.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Tests in this cluster
                  </div>
                  <ul className="space-y-1">
                    {cluster.tests.map((t) => (
                      <li key={`${t.project}-${t.fileId}-${t.testId}`} className="text-sm">
                        <RouterLink
                          to={withBase(
                            `/test/${encodeURIComponent(t.testId)}?project=${encodeURIComponent(t.project)}`
                          )}
                          className="hover:underline"
                        >
                          {t.title}
                        </RouterLink>
                        <span className="text-muted-foreground">
                          {' · '}
                          {t.occurrences} occ · last <FormattedDate date={t.lastSeen} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
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

export function FailureGroupCard({
  group,
  testId,
  cluster,
  project,
  onClustersChanged,
}: Readonly<{
  group: TestFailureGroup;
  testId: string;
  cluster: FailureCluster | undefined;
  project: string;
  onClustersChanged: () => void;
}>) {
  const name = firstLine(group.sampleMessage || group.signature);
  const resolved = cluster?.lifecycle === 'resolved';
  const resolution = useClusterResolution(cluster?.id ?? '_', project, onClustersChanged);
  return (
    <Card className={resolved ? 'opacity-70 border-success/30' : undefined}>
      <AccordionItem value={group.signature} className="border-b-0">
        <AccordionTrigger className="px-6 hover:no-underline">
          <div className="flex flex-1 items-start justify-between gap-2 text-left">
            <div className="flex flex-col items-start gap-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {group.category && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {group.category}
                  </Badge>
                )}
                {resolved && (
                  <Badge variant="outline" className="border-success/40 text-success">
                    resolved
                  </Badge>
                )}
              </div>
              <CardTitle className="text-base font-medium leading-snug break-words">
                {name}
              </CardTitle>
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
            {cluster && (
              <ClusterActions
                cluster={cluster}
                resolved={resolved}
                project={project}
                onResolve={() => resolution.setResolveDialogOpen(true)}
                onReopen={resolution.reopen}
                resolvePending={resolution.markPending}
                reopenPending={resolution.reopenPending}
              />
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6">
          {resolved && cluster?.resolution?.note && (
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
      {cluster && (
        <MarkClusterResolvedDialog
          open={resolution.resolveDialogOpen}
          onOpenChange={resolution.setResolveDialogOpen}
          clusterName={cluster.name}
          isPending={resolution.markPending}
          onSubmit={resolution.submitResolve}
        />
      )}
    </Card>
  );
}
