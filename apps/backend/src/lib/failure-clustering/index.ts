import type { ClusterOptions, ClusterReport, FailureCluster } from '@playwright-reports/shared';
import { type RegressionSummary, regressionsDb } from '../service/db/regressions.sqlite.js';
import { reportDb } from '../service/db/reports.sqlite.js';
import { testDb } from '../service/db/tests.sqlite.js';
import { buildClusters, type ReportUrlLookup } from './cluster.js';
import { FAILED_OUTCOMES, type FailedTestRun, type TestMeta, testKey } from './types.js';

const CACHE_TTL_MS = 20_000;
const CACHE_MAX_ENTRIES = 32;

interface CacheEntry {
  expires: number;
  value: ClusterReport;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(opts: ClusterOptions): string {
  return [opts.project ?? 'all', opts.from ?? '', opts.to ?? '', opts.reportId ?? ''].join('|');
}

function cacheGet(key: string): ClusterReport | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: ClusterReport): void {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function getFailureClusters(opts: ClusterOptions): Promise<ClusterReport> {
  const key = cacheKey(opts);
  const cached = cacheGet(key);
  if (cached) return cached;

  const failedRuns = loadFailedRuns(opts);
  const metaByKey = loadTestMeta(failedRuns);
  const resolveReportUrl = makeReportUrlResolver();

  let clusters = buildClusters(failedRuns, metaByKey, resolveReportUrl);

  if (opts.reportId) clusters = scopeToReport(clusters, opts.reportId);

  enrichClustersWithRegressionContext(clusters);

  clusters.sort((a, b) => {
    const ra = a.regressionContext?.membersInRegression ?? 0;
    const rb = b.regressionContext?.membersInRegression ?? 0;
    if (ra !== rb) return rb - ra;
    return 0;
  });

  const report: ClusterReport = {
    clusters,
    totalFailures: failedRuns.length,
    windowDays: computeWindowDays(opts.from, opts.to),
  };
  cacheSet(key, report);
  return report;
}

const SHARED_COMMIT_THRESHOLD = 0.8;

function enrichClustersWithRegressionContext(clusters: FailureCluster[]): void {
  const keys: Array<{ testId: string; fileId: string; project: string }> = [];
  const seen = new Set<string>();
  for (const c of clusters) {
    for (const t of c.tests) {
      const k = testKey(t.testId, t.fileId, t.project);
      if (seen.has(k)) continue;
      seen.add(k);
      keys.push({ testId: t.testId, fileId: t.fileId, project: t.project });
    }
  }
  if (keys.length === 0) return;
  const map = regressionsDb.getOpenForTests(keys);

  for (const c of clusters) {
    const memberRegressions = c.tests
      .map((t) => map.get(testKey(t.testId, t.fileId, t.project)))
      .filter((r): r is RegressionSummary => r !== undefined);
    if (memberRegressions.length === 0) {
      c.regressionContext = undefined;
      continue;
    }
    const commitCounts = new Map<string, number>();
    for (const r of memberRegressions) {
      if (r.regressedAtCommit) {
        commitCounts.set(r.regressedAtCommit, (commitCounts.get(r.regressedAtCommit) ?? 0) + 1);
      }
    }
    let sharedCommit: string | null = null;
    for (const [commit, count] of commitCounts) {
      if (count / memberRegressions.length >= SHARED_COMMIT_THRESHOLD) {
        sharedCommit = commit;
        break;
      }
    }
    const earliest = memberRegressions
      .map((r) => r.regressedAtCreatedAt)
      .sort()
      .at(0);
    c.regressionContext = {
      membersInRegression: memberRegressions.length,
      totalMembers: c.tests.length,
      sharedRegressionCommit: sharedCommit,
      earliestRegression: earliest ?? null,
    };
  }
}

export function invalidateFailureClustersCache(): void {
  cache.clear();
}

function makeReportUrlResolver(): ReportUrlLookup {
  const memo = new Map<string, string | undefined>();
  return (reportId) => {
    if (memo.has(reportId)) return memo.get(reportId);
    const url = reportDb.getByID(reportId)?.reportUrl;
    memo.set(reportId, url);
    return url;
  };
}

function loadFailedRuns(opts: ClusterOptions): FailedTestRun[] {
  const from = opts.from ?? '1970-01-01T00:00:00.000Z';
  const to = opts.to ?? new Date(Date.now() + 60_000).toISOString();
  const projectKey = opts.project && opts.project !== 'all' ? opts.project : undefined;

  const runs = testDb.getTestRunsInWindow(projectKey, from, to);
  const result: FailedTestRun[] = [];
  for (const run of runs) {
    if (FAILED_OUTCOMES.has(run.outcome)) result.push(run as FailedTestRun);
  }
  return result;
}

function loadTestMeta(runs: FailedTestRun[]): Map<string, TestMeta> {
  const projects = new Set(runs.map((r) => r.project));
  const meta = new Map<string, TestMeta>();
  for (const project of projects) {
    for (const t of testDb.getTestsByProject(project)) {
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
