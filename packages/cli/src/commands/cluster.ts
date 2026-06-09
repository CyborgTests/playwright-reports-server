import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import type { ClusterBriefResponse, ClusterReport } from '../types.js';

interface ClusterListOpts {
  project?: string;
  from?: string;
  to?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 10;

/**
 * Compact projection of /api/analytics/failure-clusters. Caps the cluster
 * list and trims per-test detail. Each cluster's `anchor` is the precise
 * "what to fix" handle the agent should act on.
 */
export async function runClusterList(opts: ClusterListOpts): Promise<void> {
  const config = resolveConfig();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const report = await apiGet<ClusterReport>(config, '/api/analytics/failure-clusters', {
    project: opts.project,
    from: opts.from,
    to: opts.to,
  });

  const trimmed = report.clusters.slice(0, limit);
  emitJson({
    window: { project: opts.project, from: opts.from, to: opts.to },
    totalFailures: report.totalFailures,
    totalClusters: report.clusters.length,
    appliedLimit: limit,
    hasMore: report.clusters.length > trimmed.length,
    clusters: trimmed.map((c) => ({
      id: c.id,
      kind: c.anchor.kind,
      name: c.name,
      sampleMessage: c.sampleMessage,
      category: c.category,
      confidence: c.confidence,
      testCount: c.testCount,
      failureCount: c.failureCount,
      anchor: c.anchor,
    })),
    clustersTruncated: report.clusters.length > limit,
  });
}

interface ClusterBriefOpts {
  project?: string;
}

/**
 * Drill into a single cluster: agent-shaped brief for every member test.
 */
export async function runClusterBrief(clusterId: string, opts: ClusterBriefOpts): Promise<void> {
  if (!clusterId) {
    throw new Error('Usage: pwrs-cli cluster brief <clusterId> [--project <p>]');
  }
  const config = resolveConfig();
  const brief = await apiGet<ClusterBriefResponse>(
    config,
    `/api/cli/cluster/${encodeURIComponent(clusterId)}/brief`,
    opts.project ? { project: opts.project } : {}
  );
  emitJson(brief);
}
