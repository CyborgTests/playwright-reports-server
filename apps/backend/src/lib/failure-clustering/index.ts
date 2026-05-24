import type {
  ClusterOptions,
  ClusterReport,
  ClusterStrategy,
  FailureCluster,
} from '@playwright-reports/shared';
import { reportDb } from '../service/db/reports.sqlite.js';
import { testDb } from '../service/db/tests.sqlite.js';
import { buildClusterTests } from './format.js';
import { mergeClusters } from './merge.js';
import { clusterByFixture } from './strategies/fixture.js';
import { clusterBySignature } from './strategies/signature.js';
import { clusterByStackFrame } from './strategies/stack-frame.js';
import { clusterByTemporal } from './strategies/temporal.js';
import {
  type ClusterWithRuns,
  FAILED_OUTCOMES,
  type FailedTestRun,
  type TestMeta,
  testKey,
} from './types.js';

const CACHE_TTL_MS = 60_000;
const DEFAULT_MIN_TESTS = 2;
const AVAILABLE_STRATEGIES: ClusterStrategy[] = ['signature', 'stack-frame', 'fixture', 'temporal'];
// `signature` is opt-in — exact-fingerprint clusters overlap with the broader
// strategies and bias toward de-duplicated narratives. Callers (UI, CLI, LLM
// queue) must include it explicitly.
const DEFAULT_STRATEGIES: ClusterStrategy[] = ['stack-frame', 'fixture', 'temporal'];

interface CacheEntry {
  expires: number;
  value: ClusterReport;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(opts: ClusterOptions): string {
  const strategies = (opts.strategies ?? AVAILABLE_STRATEGIES).slice().sort().join(',');
  return [
    opts.project ?? 'all',
    opts.from ?? '',
    opts.to ?? '',
    opts.minTests ?? DEFAULT_MIN_TESTS,
    strategies,
    opts.reportId ?? '',
  ].join('|');
}

export async function getFailureClusters(opts: ClusterOptions): Promise<ClusterReport> {
  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  const minTests = opts.minTests ?? DEFAULT_MIN_TESTS;
  const requested = opts.strategies?.length ? opts.strategies : DEFAULT_STRATEGIES;
  const strategiesRun = requested.filter((s) => AVAILABLE_STRATEGIES.includes(s));

  const failedRuns = loadFailedRuns(opts);
  const metaByKey = loadTestMeta(failedRuns);
  const reportUrlCache = new Map<string, string | undefined>();
  const resolveReportUrl = (reportId: string): string | undefined => {
    if (reportUrlCache.has(reportId)) return reportUrlCache.get(reportId);
    const url = reportDb.getByID(reportId)?.reportUrl;
    reportUrlCache.set(reportId, url);
    return url;
  };

  const rawClusters: ClusterWithRuns[] = [];
  if (strategiesRun.includes('signature')) {
    rawClusters.push(...clusterBySignature(failedRuns, { minTests }));
  }
  if (strategiesRun.includes('stack-frame')) {
    rawClusters.push(...clusterByStackFrame(failedRuns, { minTests }));
  }
  if (strategiesRun.includes('fixture')) {
    rawClusters.push(...clusterByFixture(failedRuns, { minTests }));
  }
  if (strategiesRun.includes('temporal')) {
    rawClusters.push(...clusterByTemporal(failedRuns, { minTests }));
  }

  // Strategies emit cluster + member runs together so we don't have to
  // re-derive membership from evidence (which doesn't work for temporal).
  const clusters: FailureCluster[] = rawClusters.map(({ cluster, runs }) => ({
    ...cluster,
    tests: buildClusterTests(runs, metaByKey, resolveReportUrl, cluster.strategy),
  }));

  const merged = mergeClusters(clusters);

  // Re-sort the merged list by impact (testCount × failureCount) so the
  // highest-blast-radius clusters surface first, regardless of which strategy
  // produced them. mergeClusters orders by precedence first, which is the
  // right ordering for the merge pass itself but the wrong ordering for the
  // user-facing list.
  merged.sort((a, b) => b.testCount * b.failureCount - a.testCount * a.failureCount);

  // Scope filter: when invoked from a report-detail entry button, only return
  // clusters that include at least one test that failed in that report.
  const scoped = opts.reportId ? scopeToReport(merged, opts.reportId) : merged;

  const totalFailures = failedRuns.length;
  const windowDays = computeWindowDays(opts.from, opts.to);

  const report: ClusterReport = {
    clusters: scoped,
    totalFailures,
    windowDays,
    strategiesRun,
  };

  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value: report });
  return report;
}

export function invalidateFailureClustersCache(): void {
  cache.clear();
}

function loadFailedRuns(opts: ClusterOptions): FailedTestRun[] {
  const from = opts.from ?? '1970-01-01T00:00:00.000Z';
  const to = opts.to ?? new Date(Date.now() + 60_000).toISOString();
  const projectKey = opts.project && opts.project !== 'all' ? opts.project : undefined;

  const runs = testDb.getTestRunsInWindow(projectKey, from, to);
  const result: FailedTestRun[] = [];
  for (const run of runs) {
    if (!FAILED_OUTCOMES.has(run.outcome)) continue;
    // Each strategy filters further by its own evidence requirements
    // (signature, stack frame, fixture phase). errorSignatureGlobal may be
    // missing for older rows; temporal/stack-frame still use them.
    result.push(run as FailedTestRun);
  }
  return result;
}

function loadTestMeta(runs: FailedTestRun[]): Map<string, TestMeta> {
  const projects = new Set(runs.map((r) => r.project));
  const meta = new Map<string, TestMeta>();
  for (const project of projects) {
    const tests = testDb.getTestsByProject(project);
    for (const t of tests) {
      meta.set(testKey(t.testId, t.fileId, t.project), {
        testId: t.testId,
        fileId: t.fileId,
        project: t.project,
        title: t.title,
        filePath: t.filePath,
      });
    }
  }
  return meta;
}

function scopeToReport(clusters: FailureCluster[], reportId: string): FailureCluster[] {
  const reportRuns = testDb.getTestRunsByReport(reportId);
  const failedKeys = new Set(
    reportRuns
      .filter((r) => FAILED_OUTCOMES.has(r.outcome))
      .map((r) => testKey(r.testId, r.fileId, r.project))
  );
  if (failedKeys.size === 0) return [];

  return clusters.filter((c) =>
    c.tests.some((t) => failedKeys.has(testKey(t.testId, t.fileId, t.project)))
  );
}

function computeWindowDays(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return undefined;
  return Math.max(0, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)));
}
