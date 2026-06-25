import type { ClusterReport, FailureCluster, TestFailureGroup } from '@playwright-reports/shared';
import { ExternalLink, GitMerge } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { toast } from 'sonner';
import FormattedDate from '@/components/date-format';
import { MarkClusterResolvedDialog } from '@/components/failure-clusters/MarkClusterResolvedDialog';
import type { ClusterResolutionRequest } from '@/components/failure-clusters/types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { buildUrl, withBase } from '@/lib/url';
import { servedReportUrl } from './test-detail-widgets';

function firstLine(message: string): string {
  const trimmed = message.trim();
  const newlineIdx = trimmed.search(/\r?\n/);
  return newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
}

// Normalized signature of a message's first significant line
// links a failure group to its cluster by sample-message shape.
function normalizeMessageSignature(message: string | undefined): string {
  const line =
    (message ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  return line
    .replace(/0x[0-9a-fA-F]+/g, 'H')
    .replace(/['"][^'"]*['"]/g, 'S')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function CrossTestClusterCard({
  cluster,
  project,
  onChange,
}: Readonly<{ cluster: FailureCluster; project: string; onChange: () => void }>) {
  const resolved = cluster.lifecycle === 'resolved';
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const markMutation = useMutation<{ success: boolean }, ClusterResolutionRequest>(
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
  const reopenMutation = useMutation<{ success: boolean }, ClusterResolutionRequest>(
    `/api/analytics/failure-clusters/${cluster.id}/reopen`,
    {
      method: 'POST',
      onSuccess: () => {
        toast.success('Cluster re-opened');
        onChange();
      },
    }
  );
  return (
    <Card className={resolved ? 'opacity-70 border-success/30' : undefined}>
      <Accordion type="single" collapsible>
        <AccordionItem value={cluster.id} className="border-b-0">
          {/* Actions are siblings of the trigger, not children — a <button> (the
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
            <div className="flex items-center gap-2 shrink-0 pr-6 pt-4">
              <RouterLink
                to={withBase(
                  `/failures/clusters?clusterId=${cluster.id}&project=${encodeURIComponent(project)}`
                )}
              >
                <Button variant="ghost" size="sm">
                  View
                </Button>
              </RouterLink>
              {resolved ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reopenMutation.mutate({ body: { project } })}
                  disabled={reopenMutation.isPending}
                >
                  Re-open
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResolveDialogOpen(true)}
                  disabled={markMutation.isPending}
                >
                  Mark resolved
                </Button>
              )}
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
        open={resolveDialogOpen}
        onOpenChange={setResolveDialogOpen}
        clusterName={cluster.name}
        isPending={markMutation.isPending}
        onSubmit={(input) => {
          const body: ClusterResolutionRequest = { project };
          if (input.note) body.note = input.note;
          markMutation.mutate({ body });
        }}
      />
    </Card>
  );
}

function ClusterActions({
  cluster,
  resolved,
  project,
  onResolve,
  onReopen,
  resolvePending,
  reopenPending,
}: Readonly<{
  cluster: FailureCluster;
  resolved: boolean;
  project: string;
  onResolve: () => void;
  onReopen: () => void;
  resolvePending: boolean;
  reopenPending: boolean;
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
      {cluster.anchor.kind !== 'signature' && (
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

function FailureGroupCard({
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
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const clusterId = cluster?.id ?? '_';
  const markMutation = useMutation<{ success: boolean }, ClusterResolutionRequest>(
    `/api/analytics/failure-clusters/${clusterId}/resolve`,
    {
      method: 'POST',
      onSuccess: () => {
        toast.success('Cluster marked as resolved');
        setResolveDialogOpen(false);
        onClustersChanged();
      },
    }
  );
  const reopenMutation = useMutation<{ success: boolean }, ClusterResolutionRequest>(
    `/api/analytics/failure-clusters/${clusterId}/reopen`,
    {
      method: 'POST',
      onSuccess: () => {
        toast.success('Cluster re-opened');
        onClustersChanged();
      },
    }
  );
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
                onResolve={() => setResolveDialogOpen(true)}
                onReopen={() => reopenMutation.mutate({ body: { project } })}
                resolvePending={markMutation.isPending}
                reopenPending={reopenMutation.isPending}
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
          open={resolveDialogOpen}
          onOpenChange={setResolveDialogOpen}
          clusterName={cluster.name}
          isPending={markMutation.isPending}
          onSubmit={(input) => {
            const body: ClusterResolutionRequest = { project };
            if (input.note) body.note = input.note;
            markMutation.mutate({ body });
          }}
        />
      )}
    </Card>
  );
}

function FailureGroupsList({
  groups,
  testId,
  clusterForGroup,
  unmatchedClusters,
  project,
  onClustersChanged,
}: Readonly<{
  groups: TestFailureGroup[];
  testId: string;
  clusterForGroup: Map<string, FailureCluster>;
  unmatchedClusters: FailureCluster[];
  project: string;
  onClustersChanged: () => void;
}>) {
  const RESOLVED_LIMIT = 5;
  const [showAllResolved, setShowAllResolved] = useState(false);

  const activeGroups = groups.filter((g) => {
    const c = clusterForGroup.get(g.signature);
    return c?.lifecycle !== 'resolved';
  });
  const resolvedGroups = groups.filter((g) => {
    const c = clusterForGroup.get(g.signature);
    return c?.lifecycle === 'resolved';
  });

  const activeUnmatched = unmatchedClusters.filter((c) => c.lifecycle !== 'resolved');
  const resolvedUnmatched = unmatchedClusters.filter((c) => c.lifecycle === 'resolved');

  const allResolved = [
    ...resolvedGroups.map((g) => ({ kind: 'group' as const, group: g })),
    ...resolvedUnmatched.map((c) => ({ kind: 'cluster' as const, cluster: c })),
  ];
  const visibleResolved = showAllResolved ? allResolved : allResolved.slice(0, RESOLVED_LIMIT);
  const hiddenCount = allResolved.length - visibleResolved.length;

  if (groups.length === 0 && unmatchedClusters.length === 0) return null;
  return (
    <div>
      {activeGroups.length > 0 && (
        <>
          <div className="mb-3">
            <h3 className="text-lg font-semibold">Failure patterns</h3>
            <p className="text-sm text-muted-foreground">
              Failures for this test grouped by error signature
            </p>
          </div>
          <Accordion type="multiple" className="space-y-3">
            {activeGroups.map((group) => (
              <FailureGroupCard
                key={group.signature}
                group={group}
                testId={testId}
                cluster={clusterForGroup.get(group.signature)}
                project={project}
                onClustersChanged={onClustersChanged}
              />
            ))}
          </Accordion>
        </>
      )}
      {activeUnmatched.length > 0 && (
        <div className={activeGroups.length > 0 ? 'mt-6' : undefined}>
          <div className="mb-3">
            <h3 className="text-lg font-semibold">Cross-test failure clusters</h3>
            <p className="text-sm text-muted-foreground">
              Clusters that group this test with others failing the same way
            </p>
          </div>
          <div className="space-y-3">
            {activeUnmatched.map((c) => (
              <CrossTestClusterCard
                key={c.id}
                cluster={c}
                project={project}
                onChange={onClustersChanged}
              />
            ))}
          </div>
        </div>
      )}
      {allResolved.length > 0 && (
        <div className={activeGroups.length > 0 || activeUnmatched.length > 0 ? 'mt-6' : undefined}>
          <div className="mb-3">
            <h3 className="text-lg font-semibold text-muted-foreground">
              Resolved ({allResolved.length})
            </h3>
          </div>
          <div className="space-y-3">
            {visibleResolved.map((item) => {
              if (item.kind === 'group') {
                const c = clusterForGroup.get(item.group.signature);
                if (!c) return null;
                return (
                  <CrossTestClusterCard
                    key={item.group.signature}
                    cluster={c}
                    project={project}
                    onChange={onClustersChanged}
                  />
                );
              }
              return (
                <CrossTestClusterCard
                  key={item.cluster.id}
                  cluster={item.cluster}
                  project={project}
                  onChange={onClustersChanged}
                />
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground mt-2"
              onClick={() => setShowAllResolved(true)}
            >
              Show {hiddenCount} more resolved
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function FailurePatternsWithClusters({
  groups,
  testId,
  fileId,
  project,
}: Readonly<{
  groups: TestFailureGroup[];
  testId: string;
  fileId: string;
  project: string;
}>) {
  const queryUrl = useMemo(
    () =>
      buildUrl('/api/analytics/failure-clusters', {
        project,
        testId,
        fileId,
        includeResolved: '1',
      }),
    [project, testId, fileId]
  );
  const { data, refetch } = useQuery<{ success: boolean; data: ClusterReport }>(queryUrl, {
    dependencies: [project, testId, fileId],
    staleTime: 20_000,
  });

  const { clusterForGroup, unmatchedClusters } = useMemo(() => {
    const clusters = data?.data?.clusters ?? [];
    const map = new Map<string, FailureCluster>();
    const matchedIds = new Set<string>();

    const byMsgSig = new Map<string, FailureCluster>();
    for (const c of clusters) {
      const key = normalizeMessageSignature(c.sampleMessage);
      if (key && !byMsgSig.has(key)) byMsgSig.set(key, c);
    }

    for (const g of groups) {
      const key = normalizeMessageSignature(g.sampleMessage);
      const c = key ? byMsgSig.get(key) : undefined;
      if (c && !matchedIds.has(c.id)) {
        map.set(g.signature, c);
        matchedIds.add(c.id);
      }
    }

    return {
      clusterForGroup: map,
      unmatchedClusters: clusters.filter((c) => !matchedIds.has(c.id)),
    };
  }, [data, groups]);

  return (
    <FailureGroupsList
      groups={groups}
      testId={testId}
      clusterForGroup={clusterForGroup}
      unmatchedClusters={unmatchedClusters}
      project={project}
      onClustersChanged={refetch}
    />
  );
}
