import { v4 as uuid } from 'uuid';
import { parseFailureDetails } from '../extractors/failure-details.js';
import { extractFrameFromFailure } from '../extractors/stack-trace.js';
import {
  type ClusterWithRuns,
  FAILED_OUTCOMES,
  type FailedTestRun,
  type TestKey,
  testKey,
} from '../types.js';

export interface TemporalStrategyOptions {
  minTests: number;
  /** Pair must co-fail at this rate or higher to be considered linked. */
  minRate?: number;
  /** Minimum joint failure count required for a pair to qualify. */
  minJoint?: number;
  /** Cap on reports examined (newest first) — bounds the pair matrix size. */
  maxReports?: number;
}

// Jaccard threshold: joint / (a + b - joint). Stricter than the old asymmetric
// joint/min(a,b) — a chronic failer can no longer drag an unrelated test into
// the cluster on the strength of two coincident co-failures.
const DEFAULT_MIN_RATE = 0.5;
const DEFAULT_MIN_JOINT = 2;
const DEFAULT_MAX_REPORTS = 200;

/**
 * For each pair of tests, compute how often they failed together in the same
 * report. Pairs with a high joint-failure rate are linked, and connected
 * components form clusters — capturing infra / data-fixture issues that the
 * signature- and stack-based strategies miss because the surface error text
 * differs across tests.
 */
export function clusterByTemporal(
  runs: FailedTestRun[],
  opts: TemporalStrategyOptions
): ClusterWithRuns[] {
  const minRate = opts.minRate ?? DEFAULT_MIN_RATE;
  const minJoint = opts.minJoint ?? DEFAULT_MIN_JOINT;
  const maxReports = opts.maxReports ?? DEFAULT_MAX_REPORTS;

  // Limit to the most recent `maxReports` distinct reports — bounds the
  // pair matrix on long retention windows.
  const reportsByTime = new Map<string, number>();
  for (const run of runs) {
    if (!FAILED_OUTCOMES.has(run.outcome)) continue;
    const t = Date.parse(run.createdAt);
    const existing = reportsByTime.get(run.reportId);
    if (existing === undefined || t > existing) reportsByTime.set(run.reportId, t);
  }
  const recentReports = new Set(
    [...reportsByTime.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxReports)
      .map(([id]) => id)
  );

  // Bucket runs by report into sets of unique test keys.
  const testsByReport = new Map<string, Set<TestKey>>();
  const reportsByTest = new Map<TestKey, Set<string>>();
  for (const run of runs) {
    if (!FAILED_OUTCOMES.has(run.outcome)) continue;
    if (!recentReports.has(run.reportId)) continue;
    const key = testKey(run.testId, run.fileId, run.project);
    const reportSet = testsByReport.get(run.reportId) ?? new Set<TestKey>();
    reportSet.add(key);
    testsByReport.set(run.reportId, reportSet);
    const testReports = reportsByTest.get(key) ?? new Set<string>();
    testReports.add(run.reportId);
    reportsByTest.set(key, testReports);
  }

  // Compute joint failure counts. Walk each report's test set once and bump
  // each unordered pair — O(sum_of_squares_of_set_sizes), acceptable while
  // capped at `maxReports`.
  const pairKey = (a: TestKey, b: TestKey) => (a < b ? `${a}|||${b}` : `${b}|||${a}`);
  const jointCounts = new Map<string, number>();
  for (const set of testsByReport.values()) {
    if (set.size < 2) continue;
    const arr = [...set];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const pk = pairKey(arr[i], arr[j]);
        jointCounts.set(pk, (jointCounts.get(pk) ?? 0) + 1);
      }
    }
  }

  // Build an adjacency graph from qualifying pairs.
  const adjacency = new Map<TestKey, Map<TestKey, { joint: number; rate: number }>>();
  for (const [pk, joint] of jointCounts) {
    if (joint < minJoint) continue;
    const [a, b] = pk.split('|||') as [TestKey, TestKey];
    const aFailCount = reportsByTest.get(a)?.size ?? 0;
    const bFailCount = reportsByTest.get(b)?.size ?? 0;
    // Jaccard: shared / union. Symmetric — neither test can dominate the
    // pair's score because it fails far more often than the other.
    const union = aFailCount + bFailCount - joint;
    if (union === 0) continue;
    const rate = joint / union;
    if (rate < minRate) continue;

    addEdge(adjacency, a, b, { joint, rate });
    addEdge(adjacency, b, a, { joint, rate });
  }

  // Connected components → clusters.
  const visited = new Set<TestKey>();
  const components: TestKey[][] = [];
  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    const stack: TestKey[] = [node];
    const component: TestKey[] = [];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) break;
      if (visited.has(cur)) continue;
      visited.add(cur);
      component.push(cur);
      const neighbours = adjacency.get(cur);
      if (!neighbours) continue;
      for (const n of neighbours.keys()) {
        if (!visited.has(n)) stack.push(n);
      }
    }
    if (component.length >= opts.minTests) components.push(component);
  }

  const result: ClusterWithRuns[] = [];
  for (const component of components) {
    const componentSet = new Set(component);
    const clusterRuns = runs.filter((r) =>
      componentSet.has(testKey(r.testId, r.fileId, r.project))
    );

    const frameByTest = dominantFrameByTest(clusterRuns);
    const subComponents = splitComponentByFrame(component, frameByTest, opts.minTests);

    for (const sub of subComponents) {
      const subSet = new Set(sub.tests);
      const subRuns = clusterRuns.filter((r) => subSet.has(testKey(r.testId, r.fileId, r.project)));

      let pairCount = 0;
      let rateSum = 0;
      for (let i = 0; i < sub.tests.length; i++) {
        for (let j = i + 1; j < sub.tests.length; j++) {
          const edge = adjacency.get(sub.tests[i])?.get(sub.tests[j]);
          if (edge) {
            rateSum += edge.rate;
            pairCount++;
          }
        }
      }
      const avgRate = pairCount > 0 ? rateSum / pairCount : 0;

      const sampleMessage =
        subRuns
          .map((r) => parseFailureDetails(r.failureDetails)?.message ?? '')
          .find((m) => m.length > 0) ?? '';

      result.push({
        cluster: {
          id: uuid(),
          strategy: 'temporal',
          name: buildTemporalName(sub.tests.length, sub.frame, sampleMessage),
          sampleMessage,
          testCount: sub.tests.length,
          failureCount: subRuns.length,
          evidence: sub.frame
            ? { coFailureRate: avgRate, stackFrame: sub.frame }
            : { coFailureRate: avgRate },
          tests: [],
        },
        runs: subRuns,
      });
    }
  }

  return result.sort((a, b) => b.cluster.testCount - a.cluster.testCount);
}

function dominantFrameByTest(clusterRuns: FailedTestRun[]): Map<TestKey, string | undefined> {
  const framesByTest = new Map<TestKey, Map<string, number>>();
  for (const run of clusterRuns) {
    const parsed = parseFailureDetails(run.failureDetails);
    const frame = parsed ? extractFrameFromFailure(parsed) : undefined;
    if (!frame) continue;
    const key = testKey(run.testId, run.fileId, run.project);
    const counts = framesByTest.get(key) ?? new Map<string, number>();
    counts.set(frame, (counts.get(frame) ?? 0) + 1);
    framesByTest.set(key, counts);
  }
  const result = new Map<TestKey, string | undefined>();
  for (const [key, counts] of framesByTest) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    result.set(key, top?.[0]);
  }
  return result;
}

interface SubComponent {
  tests: TestKey[];
  frame: string | undefined;
}

function splitComponentByFrame(
  component: TestKey[],
  frameByTest: Map<TestKey, string | undefined>,
  minTests: number
): SubComponent[] {
  const byFrame = new Map<string, TestKey[]>();
  const residual: TestKey[] = [];
  for (const t of component) {
    const frame = frameByTest.get(t);
    if (frame) {
      const list = byFrame.get(frame) ?? [];
      list.push(t);
      byFrame.set(frame, list);
    } else {
      residual.push(t);
    }
  }

  if (byFrame.size <= 1) {
    const frame = byFrame.size === 1 ? [...byFrame.keys()][0] : undefined;
    return [{ tests: component, frame }];
  }

  const subs: SubComponent[] = [];
  for (const [frame, tests] of byFrame) {
    if (tests.length < minTests) continue;
    subs.push({ tests, frame });
  }
  if (residual.length >= minTests) subs.push({ tests: residual, frame: undefined });
  if (subs.length === 0) return [{ tests: component, frame: undefined }];
  return subs;
}

function buildTemporalName(testCount: number, frame: string | undefined, message: string): string {
  const firstLine =
    message
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? '';
  const symptom = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  if (frame && symptom) return `Co-failure at ${frame} — ${symptom}`;
  if (frame) return `Co-failure at ${frame} (${testCount} tests)`;
  if (symptom) return `Co-failure: ${symptom}`;
  return `${testCount} tests fail together`;
}

function addEdge(
  graph: Map<TestKey, Map<TestKey, { joint: number; rate: number }>>,
  from: TestKey,
  to: TestKey,
  data: { joint: number; rate: number }
): void {
  const edges = graph.get(from) ?? new Map<TestKey, { joint: number; rate: number }>();
  edges.set(to, data);
  graph.set(from, edges);
}
