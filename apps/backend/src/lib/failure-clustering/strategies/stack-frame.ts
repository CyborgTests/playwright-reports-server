import { v4 as uuid } from 'uuid';
import { parseFailureDetails } from '../extractors/failure-details.js';
import { extractAppCodeFrame } from '../extractors/stack-trace.js';
import { type ClusterWithRuns, FAILED_OUTCOMES, type FailedTestRun, testKey } from '../types.js';

export interface StackFrameStrategyOptions {
  minTests: number;
}

interface FrameInfo {
  frame: string;
  message: string;
  runs: FailedTestRun[];
}

/**
 * Drops Playwright/node_modules/Node-internal frames, hashes the first
 * remaining user-code frame, and groups runs by that frame.
 */
export function clusterByStackFrame(
  runs: FailedTestRun[],
  opts: StackFrameStrategyOptions
): ClusterWithRuns[] {
  const byFrame = new Map<string, FrameInfo>();

  for (const run of runs) {
    if (!FAILED_OUTCOMES.has(run.outcome)) continue;
    const parsed = parseFailureDetails(run.failureDetails);
    if (!parsed) continue;
    const frame = extractAppCodeFrame(parsed.stackTrace);
    if (!frame) continue;

    const existing = byFrame.get(frame);
    if (existing) {
      existing.runs.push(run);
    } else {
      byFrame.set(frame, { frame, message: parsed.message, runs: [run] });
    }
  }

  const result: ClusterWithRuns[] = [];
  for (const info of byFrame.values()) {
    const uniqueTests = new Set(info.runs.map((r) => testKey(r.testId, r.fileId, r.project)));
    if (uniqueTests.size < opts.minTests) continue;

    const categoryCounts = new Map<string, number>();
    for (const r of info.runs) {
      if (r.failureCategory) {
        categoryCounts.set(r.failureCategory, (categoryCounts.get(r.failureCategory) ?? 0) + 1);
      }
    }
    const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    result.push({
      cluster: {
        id: uuid(),
        strategy: 'stack-frame',
        name: `Shared frame ${info.frame}`,
        sampleMessage: info.message,
        category,
        testCount: uniqueTests.size,
        failureCount: info.runs.length,
        evidence: { stackFrame: info.frame },
        tests: [],
      },
      runs: info.runs,
    });
  }

  return result.sort((a, b) => b.cluster.failureCount - a.cluster.failureCount);
}
