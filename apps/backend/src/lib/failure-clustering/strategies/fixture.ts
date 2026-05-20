import type { FixturePhase } from '@playwright-reports/shared';
import { v4 as uuid } from 'uuid';
import { parseFailureDetails } from '../extractors/failure-details.js';
import { detectFixturePhase } from '../extractors/fixture-context.js';
import { type ClusterWithRuns, FAILED_OUTCOMES, type FailedTestRun, testKey } from '../types.js';

export interface FixtureStrategyOptions {
  minTests: number;
}

interface AnnotatedRun {
  run: FailedTestRun;
  filePath: string;
  message: string;
  phase: FixturePhase;
  signature: string;
}

interface PhaseGroup {
  filePath: string;
  phase: FixturePhase;
  signature: string;
  message: string;
  runs: FailedTestRun[];
}

/**
 * Strategy 3 — fixture-failure detection.
 * Identifies runs where the failure originated in a Playwright hook
 * (beforeAll/beforeEach/afterAll/afterEach). When every failed test in a
 * single (filePath, reportId) bucket shares the same phase + normalized
 * error signature, we treat it as a cascading fixture failure and emit
 * one cluster per (filePath, phase, signature) across all reports.
 *
 * Playwright merged-blob does not expose phase as a structured field, so
 * the phase is heuristically derived from the error message — see
 * `extractors/fixture-context.ts`. Runs without a detected phase are
 * skipped.
 */
export function clusterByFixture(
  runs: FailedTestRun[],
  opts: FixtureStrategyOptions
): ClusterWithRuns[] {
  // Single pass: parse failure_details once per run, bucket by (reportId,
  // filePath), and track both the annotated runs (those with a detected phase
  // + signature) and the total failed-run count in each bucket. We need the
  // total so we can require *every* failed test in the file cascaded from the
  // same hook error.
  const annotatedByBucket = new Map<string, AnnotatedRun[]>();
  const bucketTotals = new Map<string, number>();
  for (const run of runs) {
    if (!FAILED_OUTCOMES.has(run.outcome)) continue;
    const details = parseFailureDetails(run.failureDetails);
    if (!details) continue;
    const bucketKey = `${run.reportId}::${details.filePath}`;
    bucketTotals.set(bucketKey, (bucketTotals.get(bucketKey) ?? 0) + 1);

    const phase = detectFixturePhase(details.message);
    if (!phase || !run.errorSignatureGlobal) continue;
    const list = annotatedByBucket.get(bucketKey) ?? [];
    list.push({
      run,
      filePath: details.filePath,
      message: details.message,
      phase,
      signature: run.errorSignatureGlobal,
    });
    annotatedByBucket.set(bucketKey, list);
  }

  const phaseGroups = new Map<string, PhaseGroup>();
  for (const [bucketKey, bucketAnnotated] of annotatedByBucket) {
    if (bucketAnnotated.length < 2) continue;
    // Cascading fixture failure: every failed run in this bucket points to
    // the same phase + signature. Otherwise it's mixed and we skip.
    const phase = bucketAnnotated[0].phase;
    const signature = bucketAnnotated[0].signature;
    const consistent = bucketAnnotated.every((a) => a.phase === phase && a.signature === signature);
    if (!consistent) continue;
    if (bucketAnnotated.length !== bucketTotals.get(bucketKey)) continue;

    const { filePath, message } = bucketAnnotated[0];
    const groupKey = `${filePath}::${phase}::${signature}`;
    const existing = phaseGroups.get(groupKey);
    if (existing) {
      for (const a of bucketAnnotated) existing.runs.push(a.run);
    } else {
      phaseGroups.set(groupKey, {
        filePath,
        phase,
        signature,
        message,
        runs: bucketAnnotated.map((a) => a.run),
      });
    }
  }

  const result: ClusterWithRuns[] = [];
  for (const group of phaseGroups.values()) {
    const uniqueTests = new Set(group.runs.map((r) => testKey(r.testId, r.fileId, r.project)));
    if (uniqueTests.size < opts.minTests) continue;

    result.push({
      cluster: {
        id: uuid(),
        strategy: 'fixture',
        name: `${group.phase} failure in ${group.filePath}`,
        sampleMessage: group.message,
        category: 'setup_teardown',
        testCount: uniqueTests.size,
        failureCount: group.runs.length,
        estimatedFixes: 1,
        evidence: { fixturePhase: group.phase, signature: group.signature },
        tests: [],
      },
      runs: group.runs,
    });
  }

  return result.sort((a, b) => b.cluster.failureCount - a.cluster.failureCount);
}
