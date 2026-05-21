import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import type { ClusterBriefResponse, ClusterReport } from '../types.js';

interface ClusterListOpts {
  project?: string;
  from?: string;
  to?: string;
  minTests?: number;
  strategies?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 10;

/**
 * Compact projection of /api/analytics/failure-clusters: drops the fellow-
 * travellers roster on each cluster member (noisy when an agent is just
 * trying to enumerate active clusters) and caps the cluster list.
 */
export async function runClusterList(opts: ClusterListOpts): Promise<void> {
  const config = resolveConfig();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const report = await apiGet<ClusterReport>(config, '/api/analytics/failure-clusters', {
    project: opts.project,
    from: opts.from,
    to: opts.to,
    minTests: opts.minTests,
    strategies: opts.strategies,
  });

  const trimmed = report.clusters.slice(0, limit);
  emitJson({
    window: { project: opts.project, from: opts.from, to: opts.to },
    totalFailures: report.totalFailures,
    totalClusters: report.clusters.length,
    appliedLimit: limit,
    hasMore: report.clusters.length > trimmed.length,
    strategiesRun: report.strategiesRun,
    clusters: trimmed.map((c) => ({
      id: c.id,
      strategy: c.strategy,
      name: c.name,
      sampleMessage: c.sampleMessage,
      category: c.category,
      testCount: c.testCount,
      failureCount: c.failureCount,
      evidence: c.evidence,
      tests: c.tests.map((t) => ({
        testId: t.testId,
        fileId: t.fileId,
        project: t.project,
        title: t.title,
        filePath: t.filePath,
        occurrences: t.occurrences,
        lastSeen: t.lastSeen,
        lastReportId: t.lastReportId,
      })),
    })),
    clustersTruncated: report.clusters.length > limit,
  });
}

interface ClusterBriefOpts {
  project?: string;
}

/**
 * Drill into a single cluster: agent-shaped brief for every member test.
 * Use after `cluster list` (or after reading a cluster id off a `test brief`
 * or `report brief` summary).
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
