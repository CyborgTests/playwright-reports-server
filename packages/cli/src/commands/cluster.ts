import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import type { ClusterReport } from '../types.js';

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

  emitJson({
    window: { project: opts.project, from: opts.from, to: opts.to },
    totalFailures: report.totalFailures,
    strategiesRun: report.strategiesRun,
    clusters: report.clusters.slice(0, limit).map((c) => ({
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
