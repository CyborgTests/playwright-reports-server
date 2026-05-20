import type { ClusterTest } from '@playwright-reports/shared';
import { type FailedTestRun, type TestMeta, testKey } from './types.js';

const MAX_FELLOW_TRAVELLERS = 5;

export type ReportUrlLookup = (reportId: string) => string | undefined;

/**
 * Build per-test `ClusterTest` entries for a cluster, including the
 * "previously failing alongside" fellow-travellers list. A fellow traveller is
 * another test in the same cluster that failed in at least one of the same
 * reports as the focal test. Joint rate = joint reports / focal test's reports.
 */
export function buildClusterTests(
  clusterRuns: FailedTestRun[],
  metaByKey: Map<string, TestMeta>,
  resolveReportUrl: ReportUrlLookup
): ClusterTest[] {
  // Group runs in the cluster by (test, report) so a retried failure within a
  // single report counts once when computing joint reports.
  const runsByTestKey = new Map<string, FailedTestRun[]>();
  const reportsByTestKey = new Map<string, Set<string>>();
  for (const run of clusterRuns) {
    const key = testKey(run.testId, run.fileId, run.project);
    const list = runsByTestKey.get(key) ?? [];
    list.push(run);
    runsByTestKey.set(key, list);
    const reports = reportsByTestKey.get(key) ?? new Set<string>();
    reports.add(run.reportId);
    reportsByTestKey.set(key, reports);
  }

  const lastReportByTestKey = new Map<string, FailedTestRun>();
  for (const [key, runs] of runsByTestKey) {
    const latest = runs.reduce((acc, r) => (r.createdAt > acc.createdAt ? r : acc), runs[0]);
    lastReportByTestKey.set(key, latest);
  }

  const result: ClusterTest[] = [];
  for (const [focalKey, focalRuns] of runsByTestKey) {
    const focalReports = reportsByTestKey.get(focalKey);
    if (!focalReports) continue;
    const meta = metaByKey.get(focalKey);
    const latest = lastReportByTestKey.get(focalKey);

    const fellowCounts: Array<{ key: string; joint: number }> = [];
    for (const [otherKey, otherReports] of reportsByTestKey) {
      if (otherKey === focalKey) continue;
      let joint = 0;
      for (const r of focalReports) {
        if (otherReports.has(r)) joint++;
      }
      if (joint > 0) fellowCounts.push({ key: otherKey, joint });
    }
    fellowCounts.sort((a, b) => b.joint - a.joint);

    const fellowTravellers = fellowCounts.slice(0, MAX_FELLOW_TRAVELLERS).map(({ key, joint }) => {
      const otherMeta = metaByKey.get(key);
      const [project, fileId, testId] = key.split('::');
      const fellowLatest = lastReportByTestKey.get(key);
      const fellowReportId = fellowLatest?.reportId;
      return {
        testId: otherMeta?.testId ?? testId,
        fileId: otherMeta?.fileId ?? fileId,
        project: otherMeta?.project ?? project,
        title: otherMeta?.title ?? 'Unknown test',
        filePath: otherMeta?.filePath,
        jointFailureCount: joint,
        jointFailureRate: focalReports.size > 0 ? joint / focalReports.size : 0,
        lastReportId: fellowReportId,
        lastReportUrl: fellowReportId ? resolveReportUrl(fellowReportId) : undefined,
      };
    });

    result.push({
      testId: focalRuns[0].testId,
      fileId: focalRuns[0].fileId,
      project: focalRuns[0].project,
      title: meta?.title ?? 'Unknown test',
      filePath: meta?.filePath,
      occurrences: focalRuns.length,
      lastSeen: latest?.createdAt ?? focalRuns[0].createdAt,
      fellowTravellers,
      lastReportId: latest?.reportId,
      lastReportUrl: latest?.reportId ? resolveReportUrl(latest.reportId) : undefined,
    });
  }

  return result.sort((a, b) => b.occurrences - a.occurrences);
}
