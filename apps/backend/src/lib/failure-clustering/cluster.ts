import { createHash } from 'node:crypto';
import type {
  ClusterAnchor,
  ClusterConfidence,
  ClusterTest,
  FailureCluster,
} from '@playwright-reports/shared';
import { anchorKey, classify } from './classify.js';
import { type ParsedFailureDetails, parseFailureDetails } from './extractors/failure-details.js';
import type { FailedTestRun, TestMeta } from './types.js';
import { testKey } from './types.js';

export type ReportUrlLookup = (reportId: string) => string | undefined;

interface AnnotatedRun {
  run: FailedTestRun;
  parsed: ParsedFailureDetails;
  anchor: ClusterAnchor;
}

export function buildClusters(
  failedRuns: FailedTestRun[],
  metaByKey: Map<string, TestMeta>,
  resolveReportUrl: ReportUrlLookup
): FailureCluster[] {
  // 1. Annotate every run with its parsed failure_details and anchor.
  const annotated: AnnotatedRun[] = [];
  for (const run of failedRuns) {
    const parsed = parseFailureDetails(run.failureDetails);
    if (!parsed) continue;
    annotated.push({ run, parsed, anchor: classify(run, parsed) });
  }

  // 2. Bucket by anchor key. Preserve insertion order in `firstAnchor` so
  //    later steps can reconstruct the canonical anchor instance for the
  //    cluster.
  const buckets = new Map<string, AnnotatedRun[]>();
  const firstAnchor = new Map<string, ClusterAnchor>();
  for (const a of annotated) {
    const key = anchorKey(a.anchor);
    const list = buckets.get(key);
    if (list) {
      list.push(a);
    } else {
      buckets.set(key, [a]);
      firstAnchor.set(key, a.anchor);
    }
  }

  // 3. Emit one cluster per bucket.
  const clusters: FailureCluster[] = [];
  for (const [key, members] of buckets) {
    // biome-ignore lint/style/noNonNullAssertion: keys come from firstAnchor's setter
    const anchor = firstAnchor.get(key)!;
    clusters.push(buildOneCluster(anchor, key, members, metaByKey, resolveReportUrl));
  }

  // 4. Impact-sort: higher failureCount × testCount come first.
  clusters.sort((a, b) => {
    const impact = b.failureCount * b.testCount - a.failureCount * a.testCount;
    if (impact !== 0) return impact;
    if (b.failureCount !== a.failureCount) return b.failureCount - a.failureCount;
    return a.id.localeCompare(b.id);
  });

  return clusters;
}

function buildOneCluster(
  anchor: ClusterAnchor,
  key: string,
  members: AnnotatedRun[],
  metaByKey: Map<string, TestMeta>,
  resolveReportUrl: ReportUrlLookup
): FailureCluster {
  const id = clusterId(key);

  const byTest = new Map<
    string,
    { run: FailedTestRun; occurrences: number; lastSeen: string; lastReportId: string }
  >();
  for (const { run } of members) {
    const k = testKey(run.testId, run.fileId, run.project);
    const existing = byTest.get(k);
    if (!existing) {
      byTest.set(k, {
        run,
        occurrences: 1,
        lastSeen: run.createdAt,
        lastReportId: run.reportId,
      });
    } else {
      existing.occurrences++;
      if (run.createdAt > existing.lastSeen) {
        existing.lastSeen = run.createdAt;
        existing.lastReportId = run.reportId;
      }
    }
  }

  const tests: ClusterTest[] = [];
  for (const [k, info] of byTest) {
    const meta = metaByKey.get(k);
    tests.push({
      testId: info.run.testId,
      fileId: info.run.fileId,
      project: info.run.project,
      title: meta?.title ?? 'Unknown test',
      filePath: meta?.filePath,
      occurrences: info.occurrences,
      lastSeen: info.lastSeen,
      lastReportId: info.lastReportId,
      lastReportUrl: resolveReportUrl(info.lastReportId),
    });
  }
  tests.sort((a, b) => b.occurrences - a.occurrences);

  const sampleSource = members.reduce((acc, m) => (m.run.createdAt > acc.run.createdAt ? m : acc));
  const sampleMessage = sampleSource.parsed.message;

  // Category: most common failureCategory among member runs.
  const categoryCounts = new Map<string, number>();
  for (const { run } of members) {
    if (!run.failureCategory) continue;
    categoryCounts.set(run.failureCategory, (categoryCounts.get(run.failureCategory) ?? 0) + 1);
  }
  const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    id,
    anchor,
    name: buildName(anchor, sampleMessage, tests),
    sampleMessage,
    category,
    confidence: deriveConfidence(anchor.kind, tests.length, members.length),
    testCount: tests.length,
    failureCount: members.length,
    tests,
  };
}

/** Stable ID = hex sha1 of the anchor key, truncated to 16 chars. Same anchor
 *  → same ID, across calls and across servers. */
function clusterId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** Human-readable cluster name shaped as a sentence */
function buildName(anchor: ClusterAnchor, sampleMessage: string, tests: ClusterTest[]): string {
  switch (anchor.kind) {
    case 'fixture':
      return `${anchor.phase} hook failure in ${anchor.filePath}`;
    case 'selector':
      return `${verbLabel(anchor.verb)} on ${truncate(anchor.selector, 80)}`;
    case 'frame':
      return `${verbLabel(anchor.verb)} at ${anchor.frame}`;
    case 'unmatched': {
      const title = tests[0]?.title ?? 'Unknown test';
      const symptom = firstSignificantLine(sampleMessage);
      return symptom ? `Unmatched: ${title} — ${truncate(symptom, 60)}` : `Unmatched: ${title}`;
    }
  }
}

/** Friendly verb labels for the cluster name. */
function verbLabel(verb: string): string {
  if (verb === 'strictModeViolation') return 'Ambiguous selector';
  if (verb === 'testTimeout') return 'Test timeout';
  if (verb === 'unknown') return 'Failure';
  return verb;
}

function firstSignificantLine(message: string): string {
  return (
    message
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Confidence reflects how reliably "one fix resolves all" holds for a
 *  cluster. Used by the UI to visually tier cards and by the LLM to weight
 *  whether to investigate the cluster as a single root cause vs. as a
 *  collection of similar-looking failures. */
function deriveConfidence(
  kind: ClusterAnchor['kind'],
  testCount: number,
  failureCount: number
): ClusterConfidence {
  if (kind === 'fixture') return 'high';
  if (kind === 'unmatched') return 'low';
  if (testCount >= 3) return 'high';
  if (testCount === 2) return 'medium';
  // testCount === 1
  return failureCount >= 3 ? 'medium' : 'low';
}
