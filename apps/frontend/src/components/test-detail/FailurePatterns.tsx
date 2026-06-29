import type { ClusterReport, FailureCluster, TestFailureGroup } from '@playwright-reports/shared';
import { useMemo, useState } from 'react';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import useQuery from '@/hooks/useQuery';
import { buildUrl } from '@/lib/url';
import { CrossTestClusterCard, FailureGroupCard } from './failure-pattern-cards';
import { normalizeMessageSignature } from './failure-pattern-helpers';

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

  const allResolved: FailureCluster[] = [
    ...resolvedGroups
      .map((g) => clusterForGroup.get(g.signature))
      .filter((c): c is FailureCluster => !!c),
    ...resolvedUnmatched,
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
            <p className="text-sm text-muted-foreground">Grouped by error signature</p>
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
              Other tests failing the same way as this one
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
            {visibleResolved.map((cluster) => (
              <CrossTestClusterCard
                key={cluster.id}
                cluster={cluster}
                project={project}
                onChange={onClustersChanged}
              />
            ))}
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
